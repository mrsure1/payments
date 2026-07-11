/**
 * 스마트 소비 분석기 - 메인 비즈니스 로직 및 UI 인터랙션 스크립트
 * 
 * LocalStorage를 활용한 지출 항목 관리, 금액 입력 실시간 콤마 포맷팅,
 * 월별 데이터 영구 보존 및 Chart.js를 이용한 데이터 시각화를 지원합니다.
 */

// ==========================================================================
// 1. 상태 및 상수 정의
// ==========================================================================

// 기본 지출 항목 스키마 (최초 실행 시 혹은 초기화 시 사용)
const DEFAULT_EXPENSE_ITEMS = [
    "현대카드",
    "롯데카드",
    "신한카드",
    "대출1(국민은행)",
    "대출2",
    "기타"
];

// 애플리케이션 상태 객체
const state = {
    currentMonth: "", // 현재 선택된 월 (형식: "YYYY-MM")
    items: [],        // 지출 항목 목록 (String 배열)
    data: {},         // 월별 지출 데이터 (구조: { "YYYY-MM": { "항목명": 금액, ... } })
    theme: "dark",    // 테마 설정 ("dark" 또는 "light")
    charts: {
        trend: null,  // 월별 추이 Line Chart 객체
        ratio: null   // 카테고리 비중 Doughnut Chart 객체
    },
    google: {
        clientId: "",
        apiKey: "",
        tokenClient: null,
        accessToken: null,
        isAuthenticated: false
    }
};

// ==========================================================================
// 2. 초기화 함수들
// ==========================================================================

// 문서가 모두 로드되면 실행되는 진입점
document.addEventListener("DOMContentLoaded", async () => {
    initTheme();
    initDateTime();
    loadLocalStorage();
    loadGoogleConfig(); // 구글 API 연동 설정 불러오기

    // localhost / 127.0.0.1 LocalStorage를 서버 공유 저장소와 합침
    await syncSharedStore();

    renderAll();
    initChartInstances();
    updateCharts();
    setupEventListeners();
    
    // Lucide 아이콘 활성화
    lucide.createIcons();
    
    // Google API 로드 지연 초기화 실행 (script async 대응)
    setTimeout(initGoogleApi, 1000);
});

// 테마 초기화 (기존 저장된 설정 또는 브라우저 기본 테마 반영)
function initTheme() {
    const savedTheme = localStorage.getItem("app_theme");
    if (savedTheme) {
        state.theme = savedTheme;
    } else {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        state.theme = prefersDark ? "dark" : "light";
    }
    
    if (state.theme === "light") {
        document.body.classList.remove("dark-theme");
        document.body.classList.add("light-theme");
    } else {
        document.body.classList.remove("light-theme");
        document.body.classList.add("dark-theme");
    }
}

// 초기 연월 설정 (현재 컴퓨터 날짜 기준)
function initDateTime() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    state.currentMonth = `${year}-${month}`;
    
    // 월 선택 input의 기본값 지정
    const monthPicker = document.getElementById("month-picker");
    if (monthPicker) {
        monthPicker.value = state.currentMonth;
    }
    updateMonthDisplay();
}

// LocalStorage에서 저장된 설정 및 과거 데이터 로드
function loadLocalStorage() {
    // 1) 지출 항목 목록 로드 (없으면 기본 스키마 사용)
    const savedItems = localStorage.getItem("expense_items_schema");
    if (savedItems) {
        try {
            state.items = JSON.parse(savedItems);
        } catch {
            state.items = [...DEFAULT_EXPENSE_ITEMS];
        }
    } else {
        state.items = [...DEFAULT_EXPENSE_ITEMS];
        localStorage.setItem("expense_items_schema", JSON.stringify(state.items));
    }
    
    // 2) 월별 지출 데이터 로드
    const savedData = localStorage.getItem("expense_data");
    if (savedData) {
        try {
            state.data = JSON.parse(savedData) || {};
        } catch {
            state.data = {};
        }
    } else {
        state.data = {};
        localStorage.setItem("expense_data", JSON.stringify(state.data));
    }
}

// --------------------------------------------------------------------------
// localhost ↔ 127.0.0.1 데이터 통합 (서버 data/store.json 공유)
// --------------------------------------------------------------------------

function isLocalHttpOrigin() {
    return location.protocol === "http:" || location.protocol === "https:";
}

function monthExpenseSum(monthData) {
    if (!monthData || typeof monthData !== "object") return 0;
    return Object.values(monthData).reduce((acc, val) => acc + (Number(val) || 0), 0);
}

// 두 월별 데이터셋을 합칩니다. 같은 월이면 합계가 더 큰 쪽을 채택합니다.
function mergeExpenseData(baseData, incomingData) {
    const merged = { ...(baseData || {}) };
    Object.keys(incomingData || {}).forEach((month) => {
        const incoming = incomingData[month] || {};
        const current = merged[month];
        if (!current) {
            merged[month] = { ...incoming };
            return;
        }
        if (monthExpenseSum(incoming) >= monthExpenseSum(current)) {
            merged[month] = { ...incoming };
        }
    });
    return merged;
}

// 항목 스키마 합치기 (순서 유지, 중복 제거)
function mergeItemSchema(baseItems, incomingItems) {
    const result = Array.isArray(baseItems) ? [...baseItems] : [];
    (incomingItems || []).forEach((item) => {
        if (item && !result.includes(item)) {
            result.push(item);
        }
    });
    return result.length ? result : [...DEFAULT_EXPENSE_ITEMS];
}

function buildSharedPayload() {
    return {
        schema: state.items,
        data: state.data,
        google_client_id: state.google.clientId || localStorage.getItem("google_client_id") || "",
        google_api_key: state.google.apiKey || localStorage.getItem("google_api_key") || "",
        theme: state.theme || localStorage.getItem("app_theme") || "",
    };
}

function applySharedPayloadToState(payload, { preferIncomingGoogle = true } = {}) {
    if (!payload || typeof payload !== "object") return false;

    let changed = false;

    if (Array.isArray(payload.schema) && payload.schema.length) {
        const mergedSchema = mergeItemSchema(state.items, payload.schema);
        if (JSON.stringify(mergedSchema) !== JSON.stringify(state.items)) {
            state.items = mergedSchema;
            changed = true;
        }
    }

    if (payload.data && typeof payload.data === "object") {
        const before = JSON.stringify(state.data);
        state.data = mergeExpenseData(state.data, payload.data);
        if (JSON.stringify(state.data) !== before) {
            changed = true;
        }
    }

    if (preferIncomingGoogle) {
        if (payload.google_client_id && !state.google.clientId) {
            state.google.clientId = payload.google_client_id;
            localStorage.setItem("google_client_id", payload.google_client_id);
            changed = true;
        }
        if (payload.google_api_key && !state.google.apiKey) {
            state.google.apiKey = payload.google_api_key;
            localStorage.setItem("google_api_key", payload.google_api_key);
            changed = true;
        }
    }

    if (payload.theme && !localStorage.getItem("app_theme")) {
        state.theme = payload.theme;
        localStorage.setItem("app_theme", payload.theme);
        if (state.theme === "light") {
            document.body.classList.remove("dark-theme");
            document.body.classList.add("light-theme");
        }
        changed = true;
    }

    return changed;
}

function persistLocalMirror() {
    localStorage.setItem("expense_items_schema", JSON.stringify(state.items));
    localStorage.setItem("expense_data", JSON.stringify(state.data));
}

async function fetchSharedStore() {
    if (!isLocalHttpOrigin()) return null;
    try {
        const res = await fetch("/api/data", { cache: "no-store" });
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        console.warn("공유 저장소 읽기 실패:", err);
        return null;
    }
}

async function pushSharedStore() {
    if (!isLocalHttpOrigin()) return false;
    try {
        const res = await fetch("/api/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildSharedPayload()),
        });
        return res.ok;
    } catch (err) {
        console.warn("공유 저장소 쓰기 실패:", err);
        return false;
    }
}

// 현재 브라우저 LocalStorage + 서버 공유 저장소를 합친 뒤 양쪽에 반영
async function syncSharedStore() {
    if (!isLocalHttpOrigin()) return;

    const remote = await fetchSharedStore();
    if (remote) {
        applySharedPayloadToState(remote, { preferIncomingGoogle: true });
    }

    persistLocalMirror();
    await pushSharedStore();

    const months = Object.keys(state.data || {}).filter((m) => monthHasExpense(state.data[m]));
    if (months.length > 0) {
        showSaveStatus(`데이터 동기화됨 (${months.join(", ")})`);
    } else {
        showSaveStatus("공유 저장소 연결됨");
    }
}

// 로컬 변경을 LocalStorage + 공유 저장소에 함께 반영
async function persistAllStores() {
    persistLocalMirror();
    await pushSharedStore();
}

// ==========================================================================
// 3. 렌더링 및 UI 업데이트 함수
// ==========================================================================

// 현재 상태를 바탕으로 UI의 목록, 합계, 히스토리를 렌더링합니다.
function renderAll() {
    renderExpenseList();
    renderHistoryList();
    calculateTotal();
}

// 현재 선택된 월에 맞는 지출 항목들을 테이블에 렌더링합니다.
function renderExpenseList() {
    const listContainer = document.getElementById("expense-list");
    if (!listContainer) return;
    
    listContainer.innerHTML = "";
    
    // 현재 월의 데이터 객체 가져오기 (없으면 빈 객체)
    const monthData = state.data[state.currentMonth] || {};
    const grouped = groupItemsByCategory(state.items);

    grouped.forEach(({ category, items }) => {
        const catSum = items.reduce((acc, item) => acc + (Number(monthData[item]) || 0), 0);
        const headerTr = document.createElement("tr");
        headerTr.className = "category-row";
        headerTr.setAttribute("draggable", "false");
        headerTr.innerHTML = `
            <td colspan="4">
                <div class="category-row-label">
                    <span>${escapeHtml(category)}</span>
                    <span class="category-row-sum">${formatNumberWithCommas(catSum)}원</span>
                </div>
            </td>
        `;
        listContainer.appendChild(headerTr);

        items.forEach((item) => {
            const tr = document.createElement("tr");
            // 드래그 앤 드롭 제어를 위해 항상 draggable="true"로 설정
            tr.setAttribute("draggable", "true");
            tr.setAttribute("data-item-name", item);
            
            // 해당 항목의 금액 (없으면 0 또는 빈 칸으로 노출할 수 있으나, 0원으로 기본값 설정)
            const amount = monthData[item] !== undefined ? monthData[item] : 0;
            const formattedAmount = formatNumberWithCommas(amount);
            
            tr.innerHTML = `
                <td style="text-align: center; vertical-align: middle;">
                    <div class="drag-handle" aria-label="순서 조정 핸들">
                        <i data-lucide="grip-vertical"></i>
                    </div>
                </td>
                <td><span class="expense-item-name" data-item-name="${escapeHtml(item)}" title="클릭하여 항목명 수정">${escapeHtml(item)}</span></td>
                <td>
                    <div class="expense-input-wrapper">
                        <input type="text" 
                               class="expense-input" 
                               data-item="${escapeHtml(item)}" 
                               value="${formattedAmount === "0" ? "" : formattedAmount}" 
                               placeholder="0">
                        <span class="input-suffix">원</span>
                    </div>
                </td>
                <td>
                    <button type="button" class="delete-btn" data-item="${escapeHtml(item)}" aria-label="삭제">
                        <i data-lucide="trash-2"></i>
                    </button>
                </td>
            `;
            listContainer.appendChild(tr);
        });
    });
    
    renderCategorySummary(monthData);

    // 새로 렌더링된 요소에 대해 Lucide 아이콘 및 지출 입력 이벤트 핸들링 바인딩
    lucide.createIcons();
    bindExpenseInputs();
    bindItemNameEdit();      // 항목명 클릭 인라인 편집 이벤트 바인딩 추가
    bindExpenseDragEvents(); // 드래그 앤 드롭 정렬 이벤트 바인딩 추가
}

// 카테고리별 합계 칩 렌더링
function renderCategorySummary(monthData) {
    const box = document.getElementById("category-summary");
    if (!box) return;

    const grouped = groupItemsByCategory(state.items);
    box.innerHTML = grouped.map(({ category, items }) => {
        const sum = items.reduce((acc, item) => acc + (Number(monthData[item]) || 0), 0);
        const cls = category === "보험"
            ? "is-insurance"
            : category === "카드"
                ? "is-card"
                : category === "대출"
                    ? "is-loan"
                    : "";
        return `
            <div class="category-chip ${cls}">
                <span class="category-chip-name">${escapeHtml(category)}</span>
                <span class="category-chip-sum">${formatNumberWithCommas(sum)}원</span>
            </div>
        `;
    }).join("");
}

// 과거에 저장한 월별 내역 리스트 렌더링
function renderHistoryList() {
    const historyContainer = document.getElementById("history-list");
    if (!historyContainer) return;
    
    historyContainer.innerHTML = "";
    
    // 실제 금액이 있는 월만 목록에 표시 (빈 월은 제외)
    const sortedMonths = Object.keys(state.data)
        .filter((month) => monthHasExpense(state.data[month]))
        .sort()
        .reverse();
    
    if (sortedMonths.length === 0) {
        historyContainer.innerHTML = `<li style="color: var(--text-secondary); text-align: center; padding: 20px 0; font-size: 0.9rem;">저장된 과거 지출 데이터가 없습니다.</li>`;
        return;
    }
    
    sortedMonths.forEach(month => {
        const monthData = state.data[month];
        // 한 달 전체의 합계 계산
        const sum = Object.values(monthData).reduce((acc, val) => acc + (val || 0), 0);
        
        const li = document.createElement("li");
        li.className = "history-item";
        
        // 현재 선택된 월일 경우 테두리나 배경색으로 하이라이트 표시
        if (month === state.currentMonth) {
            li.style.borderColor = "var(--accent-color)";
        }
        
        const [yearStr, monthStr] = month.split("-");
        
        li.innerHTML = `
            <div class="history-info">
                <span class="history-month">${yearStr}년 ${monthStr}월</span>
                <span class="history-sum">합계: ${formatNumberWithCommas(sum)}원</span>
            </div>
            <div class="history-actions">
                <button class="view-history-btn" data-month="${month}">불러오기</button>
                <button class="delete-btn" data-delete-month="${month}" aria-label="기록 삭제">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;
        historyContainer.appendChild(li);
    });
    
    // 동적 생성된 과거 삭제 버튼의 Lucide 아이콘 렌더링
    lucide.createIcons();
    bindHistoryActions();
}

// 현재 화면에 입력된 금액들을 모아 합계를 계산하고 하단 총합계를 실시간 업데이트합니다.
function calculateTotal() {
    let total = 0;
    const inputs = document.querySelectorAll(".expense-input");
    
    inputs.forEach(input => {
        const rawValue = input.value.replace(/,/g, "");
        const numValue = parseInt(rawValue, 10) || 0;
        total += numValue;
    });
    
    const totalDisplay = document.getElementById("total-amount-display");
    if (totalDisplay) {
        totalDisplay.textContent = formatNumberWithCommas(total);
    }
}

// 월 선택 표시부 텍스트 갱신
function updateMonthDisplay() {
    const display = document.getElementById("current-month-display");
    if (display) {
        const [year, month] = state.currentMonth.split("-");
        display.textContent = `${year}년 ${month}월`;
    }
}

// ==========================================================================
// 4. 이벤트 바인딩 및 인터랙션 핸들러
// ==========================================================================

// 금액 입력 필드에 실시간 포맷터 및 합계 계산기 바인딩
function bindExpenseInputs() {
    const inputs = document.querySelectorAll(".expense-input");
    
    inputs.forEach(input => {
        // 입력 시 콤마 자동 생성 및 숫자 제한
        input.addEventListener("input", (e) => {
            const rawVal = e.target.value.replace(/[^0-9]/g, ""); // 숫자만 추출
            if (rawVal === "") {
                e.target.value = "";
            } else {
                e.target.value = formatNumberWithCommas(parseInt(rawVal, 10));
            }
            calculateTotal();
            
            // 입력할 때마다 메모리 + 로컬스토리지에 자동 저장 (새로고침해도 유지)
            saveCurrentInputsToMemory();
            persistExpenseData();
            renderCategorySummary(state.data[state.currentMonth] || {});
            // 카테고리 헤더 합계도 갱신
            document.querySelectorAll(".category-row").forEach((row) => {
                const label = row.querySelector(".category-row-label span");
                const sumEl = row.querySelector(".category-row-sum");
                if (!label || !sumEl) return;
                const cat = label.textContent;
                const grouped = groupItemsByCategory(state.items).find((g) => g.category === cat);
                if (!grouped) return;
                const monthData = state.data[state.currentMonth] || {};
                const sum = grouped.items.reduce((acc, item) => acc + (Number(monthData[item]) || 0), 0);
                sumEl.textContent = `${formatNumberWithCommas(sum)}원`;
            });
            updateCharts();
        });
        
        // 포커스 시 입력 영역 시각적 효과 연출
        input.addEventListener("focus", (e) => {
            e.target.select();
        });
    });
    
    // 테이블 내의 삭제 버튼 바인딩 (개별 항목 삭제)
    const deleteButtons = document.querySelectorAll(".expense-table .delete-btn");
    deleteButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            const item = e.currentTarget.getAttribute("data-item");
            if (confirm(`'${item}' 지출 항목을 삭제하시겠습니까?\n삭제된 항목은 앞으로 지출 입력 목록에서 보이지 않습니다.`)) {
                deleteExpenseItem(item);
            }
        });
    });
}

// 지출 항목명 클릭 시 인라인 편집 기능 바인딩
function bindItemNameEdit() {
    const nameSpans = document.querySelectorAll(".expense-item-name");

    nameSpans.forEach(span => {
        span.addEventListener("click", () => {
            const oldName = span.getAttribute("data-item-name");
            startInlineNameEdit(span, oldName);
        });
    });
}

// 항목명 span을 입력창으로 전환하여 즉석에서 이름을 수정하도록 처리
function startInlineNameEdit(span, oldName) {
    // 이미 편집 입력창으로 전환된 상태라면 중복 실행 방지
    if (span.classList.contains("editing")) return;
    span.classList.add("editing");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "item-name-edit-input";
    input.value = oldName;
    input.setAttribute("aria-label", "지출 항목명 수정");

    // 화면상에서 span 자리에 입력창을 대신 표시
    span.replaceWith(input);
    input.focus();
    input.select();

    let finished = false; // 커밋/취소 중복 호출 방지 플래그

    // 변경 내용 확정 처리
    const commit = () => {
        if (finished) return;
        finished = true;
        const newName = input.value.trim();
        // 이름이 실제로 바뀌었을 때만 적용, 그 외에는 원상 복구
        if (newName && newName !== oldName) {
            const success = renameExpenseItem(oldName, newName);
            if (!success) {
                // 중복 등으로 실패한 경우 화면을 원래 목록으로 되돌림
                renderExpenseList();
            }
            // 성공 시 renameExpenseItem 내부에서 이미 renderAll 수행됨
        } else {
            renderExpenseList();
        }
    };

    // 편집 취소 (원래 이름 유지)
    const cancel = () => {
        if (finished) return;
        finished = true;
        renderExpenseList();
    };

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            commit();
        } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
        }
    });

    input.addEventListener("blur", commit);
}

// 지출 항목 이름 변경 (모든 월별 데이터의 키도 함께 갱신하여 금액 보존)
function renameExpenseItem(oldName, newName) {
    // 중복 이름 검사
    if (state.items.includes(newName)) {
        alert("이미 존재하는 지출 항목 이름입니다.");
        return false;
    }

    const idx = state.items.indexOf(oldName);
    if (idx === -1) return false;

    // 이름 변경 전, 현재 화면에 입력된 금액을 메모리에 동기화 (구 이름 기준으로 보존)
    saveCurrentInputsToMemory();

    // 1) 항목 목록의 순서를 유지한 채 이름만 교체
    state.items[idx] = newName;
    localStorage.setItem("expense_items_schema", JSON.stringify(state.items));

    // 2) 모든 월별 데이터에서 해당 항목의 키를 새 이름으로 변경 (입력 순서 보존)
    Object.keys(state.data).forEach(month => {
        const monthData = state.data[month];
        if (monthData && Object.prototype.hasOwnProperty.call(monthData, oldName)) {
            const rebuilt = {};
            Object.keys(monthData).forEach(key => {
                if (key === oldName) {
                    rebuilt[newName] = monthData[oldName];
                } else {
                    rebuilt[key] = monthData[key];
                }
            });
            state.data[month] = rebuilt;
        }
    });
    persistExpenseData();

    // 전체 갱신
    renderAll();
    updateCharts();
    showSaveStatus("항목 이름이 변경되었습니다.");
    return true;
}

// 과거 저장 기록들에 대한 불러오기 및 삭제 액션 바인딩
function bindHistoryActions() {
    // 1) 과거 월별 데이터 불러오기
    const viewButtons = document.querySelectorAll(".view-history-btn");
    viewButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            const month = e.currentTarget.getAttribute("data-month");
            changeMonth(month);
        });
    });
    
    // 2) 과거 월별 기록 통째로 삭제
    const deleteButtons = document.querySelectorAll("[data-delete-month]");
    deleteButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            const month = e.currentTarget.getAttribute("data-delete-month");
            if (confirm(`${month}의 저장 기록을 완전히 삭제하시겠습니까?`)) {
                deleteHistoryMonth(month);
            }
        });
    });
}

// 주요 상호작용 관련 최상위 이벤트 리스너 설정
function setupEventListeners() {
    // 1) 테마 전환
    const themeToggle = document.getElementById("theme-toggle");
    if (themeToggle) {
        themeToggle.addEventListener("click", toggleTheme);
    }
    
    // 2) 월 선택 - 이전 달 버튼
    const prevBtn = document.getElementById("prev-month-btn");
    if (prevBtn) {
        prevBtn.addEventListener("click", () => {
            adjustMonth(-1);
        });
    }
    
    // 3) 월 선택 - 다음 달 버튼
    const nextBtn = document.getElementById("next-month-btn");
    if (nextBtn) {
        nextBtn.addEventListener("click", () => {
            adjustMonth(1);
        });
    }
    
    // 4) 월 텍스트 클릭 시 데이트 피커 트리거
    const monthDisplay = document.getElementById("current-month-display");
    const monthPicker = document.getElementById("month-picker");
    if (monthDisplay && monthPicker) {
        monthDisplay.addEventListener("click", () => {
            try {
                if (typeof monthPicker.showPicker === "function") {
                    monthPicker.showPicker();
                } else {
                    monthPicker.focus();
                    monthPicker.click();
                }
            } catch (_) {
                monthPicker.focus();
                monthPicker.click();
            }
        });
        
        monthPicker.addEventListener("change", (e) => {
            if (e.target.value) {
                changeMonth(e.target.value);
            }
        });
    }
    
    // 5) 신규 항목 추가 폼 제출
    const addItemForm = document.getElementById("add-item-form");
    if (addItemForm) {
        addItemForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const nameInput = document.getElementById("new-item-name");
            if (nameInput) {
                const name = nameInput.value.trim();
                if (name) {
                    addExpenseItem(name);
                    nameInput.value = "";
                }
            }
        });
    }
    
    // 6) 저장 버튼 클릭
    const saveBtn = document.getElementById("save-data-btn");
    if (saveBtn) {
        saveBtn.addEventListener("click", () => {
            saveCurrentInputsToStorage();
        });
    }

    // 7) 구글 API 설정 모달 제어
    const openSettingsBtn = document.getElementById("open-settings-btn");
    const closeSettingsBtn = document.getElementById("close-settings-btn");
    const saveSettingsBtn = document.getElementById("save-settings-btn");
    const settingsModal = document.getElementById("api-settings-modal");

    if (openSettingsBtn && settingsModal) {
        openSettingsBtn.addEventListener("click", () => {
            // 현재 저장된 설정을 인풋 필드에 세팅
            document.getElementById("settings-client-id").value = state.google.clientId || "";
            document.getElementById("settings-api-key").value = state.google.apiKey || "";
            settingsModal.classList.remove("hidden");
        });
    }

    if (closeSettingsBtn && settingsModal) {
        closeSettingsBtn.addEventListener("click", () => {
            settingsModal.classList.add("hidden");
        });
    }

    if (saveSettingsBtn && settingsModal) {
        saveSettingsBtn.addEventListener("click", () => {
            const clientId = document.getElementById("settings-client-id").value.trim();
            const apiKey = document.getElementById("settings-api-key").value.trim();
            saveGoogleConfig(clientId, apiKey);
            settingsModal.classList.add("hidden");
        });
    }

    // 8) 구글 로그인 및 로그아웃 핸들러 바인딩
    const googleLoginBtn = document.getElementById("google-login-btn");
    if (googleLoginBtn) {
        googleLoginBtn.addEventListener("click", handleGoogleAuth);
    }

    const googleLogoutBtn = document.getElementById("google-logout-btn");
    if (googleLogoutBtn) {
        googleLogoutBtn.addEventListener("click", handleGoogleSignout);
    }

    // 9) 드라이브 백업 / 복원 버튼 바인딩
    const driveBackupBtn = document.getElementById("drive-backup-btn");
    if (driveBackupBtn) {
        driveBackupBtn.addEventListener("click", backupDataToGoogleDrive);
    }

    const driveRestoreBtn = document.getElementById("drive-restore-btn");
    if (driveRestoreBtn) {
        driveRestoreBtn.addEventListener("click", restoreDataFromGoogleDrive);
    }

    // 10) 드라이브 JSON 파일 직접 가져오기 (복원이 실패할 때 수동 합치기)
    const importJsonBtn = document.getElementById("import-json-btn");
    const importJsonFile = document.getElementById("import-json-file");
    if (importJsonBtn && importJsonFile) {
        importJsonBtn.addEventListener("click", () => importJsonFile.click());
        importJsonFile.addEventListener("change", handleImportJsonFile);
    }
}

// ==========================================================================
// 5. 비즈니스 로직 연산 및 데이터 조작 함수
// ==========================================================================

// 현재 화면의 모든 Input 값을 객체 구조로 수집하여 상태 메모리에 임시 기록합니다.
// force=false(기본): 화면이 전부 0인데 기존 달에 금액이 있으면 덮어쓰지 않음
// (월만 스쳐도 자동저장 때문에 6월 등이 0원으로 날아가는 사고 방지)
function saveCurrentInputsToMemory({ force = false } = {}) {
    const inputs = document.querySelectorAll(".expense-input");
    const monthData = {};
    
    inputs.forEach(input => {
        const item = input.getAttribute("data-item");
        const rawValue = input.value.replace(/,/g, "");
        const numValue = parseInt(rawValue, 10) || 0;
        monthData[item] = numValue;
    });

    const newSum = monthExpenseSum(monthData);
    const oldSum = monthExpenseSum(state.data[state.currentMonth]);
    if (!force && newSum === 0 && oldSum > 0) {
        return false;
    }
    
    state.data[state.currentMonth] = monthData;
    return true;
}

// 메모리의 월별 데이터를 LocalStorage + 공유 저장소에 즉시 반영합니다.
function persistExpenseData() {
    localStorage.setItem("expense_data", JSON.stringify(state.data));
    // 공유 저장소는 비동기 반영 (입력 반응성 유지)
    pushSharedStore();
    // 구글 로그인 상태면 드라이브에도 자동 백업 (디바운스)
    scheduleAutoDriveSync();
}

let autoDriveSyncTimer = null;
let autoDriveSyncInFlight = false;

function scheduleAutoDriveSync() {
    if (!state.google.isAuthenticated) return;
    if (localStorage.getItem("google_drive_scope") !== "drive") return;
    clearTimeout(autoDriveSyncTimer);
    autoDriveSyncTimer = setTimeout(() => {
        autoSyncToGoogleDrive({ silent: true });
    }, 1800);
}

// 조용한 자동 동기화: 드라이브 ↔ 로컬 합친 뒤 업로드
async function autoSyncToGoogleDrive({ silent = true, pullFirst = false } = {}) {
    if (!state.google.isAuthenticated || !state.google.accessToken) return false;
    if (autoDriveSyncInFlight) return false;
    if (typeof gapi === "undefined" || !gapi.client) return false;

    autoDriveSyncInFlight = true;
    try {
        if (pullFirst) {
            const driveBundle = await loadAndMergeAllDriveBackups();
            if (driveBundle.files.length) {
                applyRestoredData(
                    { schema: driveBundle.schema, data: driveBundle.data },
                    { merge: true }
                );
            }
        }

        saveCurrentInputsToMemory();
        const driveBundle = await loadAndMergeAllDriveBackups();
        let fileId = driveBundle.primaryFileId || null;
        let mergedSchema = mergeItemSchema(driveBundle.schema || [], state.items);
        let mergedData = mergeExpenseData(driveBundle.data || {}, state.data);

        const backupPayload = {
            schema: mergedSchema,
            data: mergedData,
            lastUpdated: new Date().toISOString(),
            source: location.origin,
            auto: true,
        };
        const fileContent = JSON.stringify(backupPayload, null, 2);

        if (fileId) {
            await gapi.client.request({
                path: `/upload/drive/v3/files/${fileId}`,
                method: "PATCH",
                params: { uploadType: "media" },
                headers: { "Content-Type": "application/json" },
                body: fileContent,
            });
            for (const dup of driveBundle.files.slice(1)) {
                try {
                    await gapi.client.drive.files.update({
                        fileId: dup.id,
                        resource: { trashed: true },
                    });
                } catch (_) { /* ignore */ }
            }
        } else {
            const metadata = {
                name: "smart_expense_data.json",
                mimeType: "application/json",
            };
            const boundary = "314159265358979323846";
            const delimiter = "\r\n--" + boundary + "\r\n";
            const close_delim = "\r\n--" + boundary + "--";
            const multipartRequestBody =
                delimiter +
                "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
                JSON.stringify(metadata) +
                delimiter +
                "Content-Type: application/json\r\n\r\n" +
                fileContent +
                close_delim;

            await gapi.client.request({
                path: "/upload/drive/v3/files",
                method: "POST",
                params: { uploadType: "multipart" },
                headers: { "Content-Type": "multipart/related; boundary=" + boundary },
                body: multipartRequestBody,
            });
        }

        state.items = mergedSchema;
        state.data = mergedData;
        persistLocalMirror();
        await pushSharedStore();
        if (!silent) {
            renderAll();
            updateCharts();
        } else {
            renderHistoryList();
            renderCategorySummary(state.data[state.currentMonth] || {});
        }
        showSaveStatus("드라이브 자동 동기화 완료");
        return true;
    } catch (err) {
        console.warn("자동 드라이브 동기화 실패:", err);
        if (!silent) {
            alert("자동 동기화 실패: " + (err.result?.error?.message || err.message));
        }
        return false;
    } finally {
        autoDriveSyncInFlight = false;
        updateGoogleLoginUI();
    }
}

// 해당 월에 실제 지출(0원 초과)이 있는지 확인
function monthHasExpense(monthData) {
    if (!monthData || typeof monthData !== "object") return false;
    return Object.values(monthData).some((val) => (Number(val) || 0) > 0);
}

// 현재 입력 데이터를 LocalStorage에 영구 저장합니다.
function saveCurrentInputsToStorage() {
    // 저장 버튼은 사용자가 의도한 값이므로 0원이어도 강제 반영
    saveCurrentInputsToMemory({ force: true });
    persistExpenseData();
    
    // 저장 알림 표시 및 피드백 애니메이션
    const monthLabel = state.currentMonth.replace("-", "년 ") + "월";
    const sum = Object.values(state.data[state.currentMonth] || {})
        .reduce((acc, val) => acc + (Number(val) || 0), 0);
    showSaveStatus(`${monthLabel} 저장 완료 (${formatNumberWithCommas(sum)}원)`);
    
    // 화면 정보 다시 출력 및 차트 리프레시
    renderHistoryList();
    updateCharts();
}

// 저장 완료 상태 뱃지 텍스트 애니메이션
function showSaveStatus(message) {
    const statusBadge = document.getElementById("save-status");
    if (statusBadge) {
        statusBadge.textContent = message;
        statusBadge.style.opacity = "1";
        
        setTimeout(() => {
            statusBadge.textContent = "자동 저장 완료";
        }, 3000);
    }
}

// 월 이동 로직 (이전달: -1, 다음달: +1)
function adjustMonth(offset) {
    const [year, month] = state.currentMonth.split("-").map(Number);
    const date = new Date(year, month - 1 + offset, 1);
    
    const newYear = date.getFullYear();
    const newMonth = String(date.getMonth() + 1).padStart(2, '0');
    
    changeMonth(`${newYear}-${newMonth}`);
}

// 월 전환 시 작동 방식
function changeMonth(targetMonth) {
    // 1) 전환 전 현재 입력 내용을 메모리 + 로컬스토리지에 자동 저장
    saveCurrentInputsToMemory();
    persistExpenseData();
    
    // 2) 타겟 월 변경 및 UI 적용
    state.currentMonth = targetMonth;
    const monthPicker = document.getElementById("month-picker");
    if (monthPicker) {
        monthPicker.value = targetMonth;
    }
    updateMonthDisplay();
    
    // 3) 화면 새로 렌더링 및 차트 갱신
    renderAll();
    updateCharts();
}

// 지출 목록 항목 신규 추가
function addExpenseItem(itemName) {
    // 중복 검사
    if (state.items.includes(itemName)) {
        alert("이미 존재하는 지출 항목입니다.");
        return;
    }
    
    // 스키마에 추가 및 로컬 저장
    state.items.push(itemName);
    localStorage.setItem("expense_items_schema", JSON.stringify(state.items));
    
    // 현재 월의 임시 데이터 구조에도 0원으로 세팅
    if (!state.data[state.currentMonth]) {
        state.data[state.currentMonth] = {};
    }
    state.data[state.currentMonth][itemName] = 0;
    persistExpenseData();
    
    // 전체 갱신
    renderAll();
    updateCharts();
}

// 지출 목록 항목 삭제
function deleteExpenseItem(itemName) {
    // 스키마에서 필터링 제거
    state.items = state.items.filter(item => item !== itemName);
    localStorage.setItem("expense_items_schema", JSON.stringify(state.items));
    
    // 각 월별 데이터셋에서도 해당 항목 제거하여 정밀도 유지
    Object.keys(state.data).forEach(month => {
        if (state.data[month][itemName] !== undefined) {
            delete state.data[month][itemName];
        }
    });
    persistExpenseData();
    
    // 전체 갱신
    renderAll();
    updateCharts();
}

// 특정 달의 저장 데이터 통째로 삭제
function deleteHistoryMonth(month) {
    if (state.data[month]) {
        delete state.data[month];
        persistExpenseData();
        
        // 현재 삭제 대상 월을 보고 있었다면 현재 화면 초기화
        if (state.currentMonth === month) {
            renderAll();
        } else {
            renderHistoryList();
        }
        updateCharts();
    }
}

// 테마 토글 핸들러
function toggleTheme() {
    if (document.body.classList.contains("dark-theme")) {
        document.body.classList.remove("dark-theme");
        document.body.classList.add("light-theme");
        state.theme = "light";
    } else {
        document.body.classList.remove("light-theme");
        document.body.classList.add("dark-theme");
        state.theme = "dark";
    }
    localStorage.setItem("app_theme", state.theme);
    
    // 차트 테마 업데이트를 위해 차트 재생성
    recreateChartsForTheme();
}

// ==========================================================================
// 6. 데이터 시각화 (Chart.js 연동)
// ==========================================================================

// 최초 차트 인스턴스 뼈대 설정
function initChartInstances() {
    const themeColors = getThemeSpecificChartColors();
    
    // 1) 월별 지출 트렌드 라인 차트
    const trendCtx = document.getElementById("trendChart").getContext("2d");
    state.charts.trend = new Chart(trendCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: '총 지출 금액 (원)',
                data: [],
                borderColor: '#6366f1',
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                borderWidth: 3,
                fill: true,
                tension: 0.35,
                pointBackgroundColor: '#a855f7',
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` 총 지출: ${formatNumberWithCommas(context.raw)}원`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: themeColors.gridColor
                    },
                    ticks: {
                        color: themeColors.textColor
                    }
                },
                y: {
                    grid: {
                        color: themeColors.gridColor
                    },
                    ticks: {
                        color: themeColors.textColor,
                        callback: function(value) {
                            return formatNumberWithCommas(value);
                        }
                    }
                }
            }
        }
    });

    // 2) 카테고리 비중 도넛 차트
    const ratioCtx = document.getElementById("ratioChart").getContext("2d");
    state.charts.ratio = new Chart(ratioCtx, {
        type: 'doughnut',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: [...CHART_PALETTE],
                borderWidth: state.theme === "dark" ? 2 : 1,
                borderColor: state.theme === "dark" ? '#1e293b' : '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: themeColors.textColor,
                        font: {
                            family: 'Inter',
                            size: 11
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            return ` ${context.label}: ${formatNumberWithCommas(value)}원`;
                        }
                    }
                }
            },
            cutout: '65%'
        }
    });
}

// 상태 데이터 변화 시 차트 데이터 갱신
function updateCharts() {
    if (!state.charts.trend || !state.charts.ratio) return;

    // 1) 트렌드 차트 업데이트
    const months = Object.keys(state.data).sort();
    const trendData = months.map(month => {
        return Object.values(state.data[month]).reduce((sum, val) => sum + (val || 0), 0);
    });

    state.charts.trend.data.labels = months.map(m => {
        const [y, mm] = m.split("-");
        return `${y.substring(2)}년 ${mm}월`;
    });
    state.charts.trend.data.datasets[0].data = trendData;
    state.charts.trend.update();

    // 2) 도넛 차트 업데이트 (현재 선택된 월의 지출 카테고리 비중)
    // 항목명의 괄호 앞부분을 카테고리로 묶어 합산합니다.
    // 예) "보험(삼성생명)", "보험(메리츠)" -> "보험" 하나의 카테고리로 집계
    const monthData = state.data[state.currentMonth] || {};
    const categoryTotals = {};

    Object.keys(monthData).forEach(item => {
        const val = monthData[item] || 0;
        if (val > 0) { // 0원인 항목은 시각화 왜곡 방지를 위해 노출 안함
            const category = getCategoryFromItemName(item);
            categoryTotals[category] = (categoryTotals[category] || 0) + val;
        }
    });

    const labels = Object.keys(categoryTotals);
    const values = labels.map(label => categoryTotals[label]);

    const noDataMsg = document.getElementById("no-data-msg");
    const ratioCanvas = document.getElementById("ratioChart");

    if (values.length === 0) {
        // 지출 내역이 아예 없는 경우 대체 문구 출력 (캔버스는 숨겨 문구가 가로로 보이게 함)
        if (noDataMsg) noDataMsg.classList.remove("hidden");
        if (ratioCanvas) {
            ratioCanvas.style.display = "none";
            ratioCanvas.style.opacity = "0";
        }
        state.charts.ratio.data.labels = [];
        state.charts.ratio.data.datasets[0].data = [];
        state.charts.ratio.update();
    } else {
        if (noDataMsg) noDataMsg.classList.add("hidden");
        if (ratioCanvas) {
            ratioCanvas.style.display = "block";
            ratioCanvas.style.opacity = "1";
        }
        
        state.charts.ratio.data.labels = labels;
        state.charts.ratio.data.datasets[0].data = values;
        // 카테고리 수에 맞춰 팔레트를 순환 적용 (항목이 8개를 넘어도 색상 보장)
        state.charts.ratio.data.datasets[0].backgroundColor =
            labels.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]);
        state.charts.ratio.update();
    }
}

// 라이트/다크 테마 스위칭에 부합하도록 차트 디자인 즉시 재설정
function recreateChartsForTheme() {
    if (state.charts.trend) state.charts.trend.destroy();
    if (state.charts.ratio) state.charts.ratio.destroy();
    
    initChartInstances();
    updateCharts();
}

// 테마에 맞는 차트 폰트 및 그리드 색상 계산
function getThemeSpecificChartColors() {
    const isDark = state.theme === "dark";
    return {
        textColor: isDark ? '#94a3b8' : '#64748b',
        gridColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 23, 42, 0.06)'
    };
}

// ==========================================================================
// 7. 유틸리티 헬퍼 함수
// ==========================================================================

// 세 자리마다 콤마를 찍어 주는 통화 포맷터
function formatNumberWithCommas(number) {
    if (number === null || number === undefined) return "0";
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 항목명에서 카테고리를 추출합니다.
// 괄호(반각 "(" 또는 전각 "（") 앞부분을 카테고리로 간주합니다.
// 예) "보험(삼성생명)" -> "보험", "보험 (메리츠화재)" -> "보험", "현대카드" -> "현대카드"
function getCategoryFromItemName(itemName) {
    if (!itemName) return "";
    const match = itemName.match(/^\s*([^(（]+?)\s*[\(（]/);
    if (match && match[1]) {
        return match[1].trim();
    }
    return itemName.trim();
}

// 화면 구분용 대분류 (카드 / 보험 / 대출 / 기타·세부카테고리)
function getExpenseGroup(itemName) {
    const raw = (itemName || "").trim();
    const prefix = getCategoryFromItemName(raw);

    if (/카드/.test(raw) || /카드$/.test(prefix)) return "카드";
    if (/^보험/.test(raw) || /^보험/.test(prefix)) return "보험";
    if (/^대출/.test(raw) || /^대출/.test(prefix)) return "대출";

    // 괄호형 세부 카테고리 (예: 통신(SKT))는 앞부분을 그룹으로
    if (prefix && prefix !== raw) return prefix;
    return "기타";
}

const CATEGORY_ORDER = ["카드", "보험", "대출", "기타"];

function groupItemsByCategory(items) {
    const map = new Map();
    (items || []).forEach((item) => {
        const cat = getExpenseGroup(item);
        if (!map.has(cat)) map.set(cat, []);
        map.get(cat).push(item);
    });

    const keys = Array.from(map.keys()).sort((a, b) => {
        const ia = CATEGORY_ORDER.indexOf(a);
        const ib = CATEGORY_ORDER.indexOf(b);
        const sa = ia === -1 ? 100 : ia;
        const sb = ib === -1 ? 100 : ib;
        if (sa !== sb) return sa - sb;
        return a.localeCompare(b, "ko");
    });

    return keys.map((category) => ({ category, items: map.get(category) }));
}

// 카테고리 도넛 차트에 사용할 색상 팔레트 (항목 수가 많을 경우 순환 사용)
const CHART_PALETTE = [
    '#6366f1', '#a855f7', '#ec4899', '#f43f5e',
    '#10b981', '#f59e0b', '#3b82f6', '#06b6d4',
    '#8b5cf6', '#14b8a6', '#ef4444', '#eab308'
];

// XSS 취약성 사전 차단을 위한 HTML 이스케이프 유틸
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// ==========================================================================
// 8. 구글 드라이브 동기화 비즈니스 로직
// ==========================================================================

// 로컬 스토리지에서 구글 API 설정 로드
function loadGoogleConfig() {
    state.google.clientId = localStorage.getItem("google_client_id") || "";
    state.google.apiKey = localStorage.getItem("google_api_key") || "";
}

// 구글 API 설정 로컬 스토리지 저장 및 재활성화
function saveGoogleConfig(clientId, apiKey) {
    state.google.clientId = clientId;
    state.google.apiKey = apiKey;
    
    localStorage.setItem("google_client_id", clientId);
    localStorage.setItem("google_api_key", apiKey);
    pushSharedStore();
    
    showSaveStatus("API 설정이 저장되었습니다.");
    
    // 설정 저장 후 구글 API SDK 다시 초기화 시도
    initGoogleApi();
}

// Google gapi client 및 Identity Services SDK 초기화
async function initGoogleApi() {
    // SDK 존재 여부 체크
    if (typeof gapi === 'undefined' || typeof google === 'undefined') {
        console.warn("구글 API SDK가 아직 로드되지 않았습니다. 인터넷 연결이나 스크립트 태그를 확인하세요.");
        return;
    }

    if (!state.google.clientId) {
        console.info("구글 OAuth Client ID가 아직 설정되지 않았습니다. API 연동 설정에서 등록하세요.");
        return;
    }

    try {
        // gapi 클라이언트 초기화 (구글 드라이브 파일 조작을 위해 필요)
        await new Promise((resolve) => gapi.load('client', resolve));
        
        await gapi.client.init({
            apiKey: state.google.apiKey,
            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
        });
        
        // GIS(Google Identity Services) 토큰 클라이언트 초기화
        // PC/모바일 간 백업 JSON을 서로 찾기 위해 drive 권한 사용
        state.google.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: state.google.clientId,
            scope: "https://www.googleapis.com/auth/drive",
            callback: (response) => {
                if (response.error !== undefined) {
                    alert("구글 로그인 승인 중 오류가 발생했습니다: " + response.error);
                    return;
                }
                state.google.accessToken = response.access_token;
                state.google.isAuthenticated = true;

                // 새로고침 후에도 로그인이 유지되도록 토큰과 만료 시각을 저장
                const expiresInSec = response.expires_in ? Number(response.expires_in) : 3600;
                localStorage.setItem("google_access_token", response.access_token);
                localStorage.setItem("google_token_expiry", String(Date.now() + expiresInSec * 1000));

                // 실제 부여된 스코프 기록 (drive.file 만이면 복원 실패함)
                const granted = String(response.scope || "");
                const scopes = granted.split(/\s+/).filter(Boolean);
                const fullDrive = scopes.includes("https://www.googleapis.com/auth/drive");
                localStorage.setItem("google_drive_scope", fullDrive ? "drive" : "drive.file");
                localStorage.setItem("google_granted_scopes", granted);

                // 백업/복원 원활한 가동을 위한 토큰 헤더 셋업
                gapi.client.setToken(response);
                
                updateGoogleLoginUI();
                if (fullDrive) {
                    showSaveStatus("구글 드라이브 연동에 성공했습니다.");
                    // 로그인 직후 드라이브에서 자동으로 가져와 합침
                    autoSyncToGoogleDrive({ silent: true, pullFirst: true }).then(() => {
                        renderAll();
                        updateCharts();
                    });
                } else {
                    showSaveStatus("권한 부족: 다시 로그인 필요");
                    alert(
                        "드라이브 권한이 부족합니다.\n\n" +
                        "로그인 화면에서 Google Drive 접근을 허용해 주세요.\n" +
                        "구글 클라우드 콘솔 OAuth 범위에\n" +
                        ".../auth/drive 가 추가돼 있는지도 확인하세요."
                    );
                }
            },
        });

        // 이전 세션에서 저장한 토큰이 아직 만료되지 않았으면 로그인 상태를 복원
        const savedToken = localStorage.getItem("google_access_token");
        const savedExpiry = Number(localStorage.getItem("google_token_expiry") || "0");
        if (savedToken && Date.now() < savedExpiry) {
            state.google.accessToken = savedToken;
            state.google.isAuthenticated = true;
            gapi.client.setToken({ access_token: savedToken });
            updateGoogleLoginUI();
            // 저장된 세션이면 조용히 드라이브와 맞춤
            if (localStorage.getItem("google_drive_scope") === "drive") {
                setTimeout(() => {
                    autoSyncToGoogleDrive({ silent: true, pullFirst: true }).then(() => {
                        renderAll();
                        updateCharts();
                    });
                }, 400);
            }
        } else if (savedToken) {
            // 만료된 토큰: 조용히 재발급 시도 (동의 화면 없이)
            localStorage.removeItem("google_access_token");
            localStorage.removeItem("google_token_expiry");
            if (state.google.tokenClient) {
                try {
                    state.google.tokenClient.requestAccessToken({ prompt: "" });
                } catch (_) { /* ignore */ }
            }
        }

        console.log("구글 API 및 GIS SDK 초기화가 완료되었습니다.");
    } catch (err) {
        console.error("구글 API 초기화 중 예외 발생:", err);
    }
}

// 구글 로그인 권한 인증 실행
function handleGoogleAuth() {
    // file:// 로 열면 구글 OAuth가 원본(Origin) 정책으로 막힘
    if (location.protocol === "file:") {
        alert(
            "구글 로그인은 로컬 파일(file://)에서는 동작하지 않습니다.\n\n" +
            "폴더의 start.bat 을 더블클릭해\n" +
            "http://localhost:5500 으로 열어 주세요."
        );
        return;
    }

    if (!state.google.clientId) {
        alert("먼저 'API 연동 설정' 버튼을 눌러 구글 클라우드에서 발급받은 Client ID를 입력하세요.");
        const settingsModal = document.getElementById("api-settings-modal");
        if (settingsModal) {
            settingsModal.classList.remove("hidden");
            const clientInput = document.getElementById("settings-client-id");
            if (clientInput) clientInput.focus();
        }
        return;
    }

    if (typeof google === "undefined" || !google.accounts || !google.accounts.oauth2) {
        alert("구글 로그인 SDK가 아직 로드되지 않았습니다.\n인터넷 연결을 확인한 뒤 새로고침해 주세요.");
        return;
    }

    showSaveStatus("구글 로그인 창을 여는 중...");

    // 예전 drive.file 권한 토큰이면 폐기 후 새 권한으로 재로그인
    const savedScope = localStorage.getItem("google_drive_scope");
    if (savedScope !== "drive") {
        localStorage.removeItem("google_access_token");
        localStorage.removeItem("google_token_expiry");
        state.google.accessToken = null;
        state.google.isAuthenticated = false;
        if (typeof gapi !== "undefined" && gapi.client) {
            gapi.client.setToken(null);
        }
    }

    if (!state.google.tokenClient) {
        initGoogleApi().then(() => {
            if (state.google.tokenClient) {
                state.google.tokenClient.requestAccessToken({ prompt: "consent" });
            } else {
                alert(
                    "구글 API 초기화에 실패했습니다.\n\n" +
                    "1) API 연동 설정의 Client ID가 올바른지\n" +
                    "2) 구글 콘솔 승인된 자바스크립트 원본에\n" +
                    "   http://localhost:5500 과 https://mrsure1.github.io 이 등록됐는지 확인하세요."
                );
            }
        });
    } else {
        // 권한 변경을 반영하려면 consent 화면을 다시 띄움
        state.google.tokenClient.requestAccessToken({ prompt: "consent" });
    }
}

// 구글 로그아웃
function handleGoogleSignout() {
    // 저장해 둔 로그인 토큰 제거 (새로고침 시 자동 복원 방지)
    localStorage.removeItem("google_access_token");
    localStorage.removeItem("google_token_expiry");

    if (state.google.accessToken) {
        google.accounts.oauth2.revoke(state.google.accessToken, () => {
            state.google.accessToken = null;
            state.google.isAuthenticated = false;
            gapi.client.setToken(null);

            updateGoogleLoginUI();
            showSaveStatus("로그아웃 되었습니다.");
        });
    } else {
        state.google.isAuthenticated = false;
        updateGoogleLoginUI();
    }
}

// 로그인 상태에 따른 구글 위젯 UI 갱신
function updateGoogleLoginUI() {
    const driveStatus = document.getElementById("drive-status");
    const loginBtn = document.getElementById("google-login-btn");
    const logoutBtn = document.getElementById("google-logout-btn");
    const opsGroup = document.getElementById("drive-ops-group");

    if (state.google.isAuthenticated) {
        if (driveStatus) {
            const autoOn = localStorage.getItem("google_drive_scope") === "drive";
            driveStatus.textContent = autoOn ? "자동 동기화" : "연결됨";
            driveStatus.className = "status-badge connect-badge";
        }
        if (loginBtn) loginBtn.classList.add("hidden");
        if (logoutBtn) logoutBtn.classList.remove("hidden");
        if (opsGroup) opsGroup.classList.remove("hidden");
    } else {
        if (driveStatus) {
            driveStatus.textContent = "연결 해제됨";
            driveStatus.className = "status-badge disconnect-badge";
        }
        if (loginBtn) loginBtn.classList.remove("hidden");
        if (logoutBtn) logoutBtn.classList.add("hidden");
        if (opsGroup) opsGroup.classList.add("hidden");
    }
}

// 이전에 확인된 통합 백업 파일 ID (앱 간 권한 이슈 시 직접 조회용)
const KNOWN_BACKUP_FILE_IDS = [
    "1LDreX17VnRBKKc1tafs14g9E9ciqZTxT",
];

// 드라이브에서 백업 파일 목록 조회 (여러 검색어 + 알려진 ID)
async function listDriveBackupFiles() {
    const found = new Map();

    const queries = [
        "name = 'smart_expense_data.json' and trashed = false",
        "name contains 'smart_expense_data' and trashed = false",
        "name contains 'smart_expense' and trashed = false",
    ];

    for (const q of queries) {
        try {
            const response = await gapi.client.drive.files.list({
                q,
                fields: "files(id, name, modifiedTime, size, createdTime)",
                pageSize: 50,
                orderBy: "modifiedTime desc",
                spaces: "drive",
                corpora: "user",
            });
            (response.result.files || []).forEach((f) => found.set(f.id, f));
        } catch (err) {
            console.warn("드라이브 검색 실패:", q, err);
        }
    }

    // 목록에 없어도 알려진 파일 ID는 메타데이터로 직접 확인
    for (const id of KNOWN_BACKUP_FILE_IDS) {
        if (found.has(id)) continue;
        try {
            const meta = await gapi.client.drive.files.get({
                fileId: id,
                fields: "id, name, modifiedTime, size, createdTime, trashed",
            });
            if (meta.result && !meta.result.trashed) {
                found.set(id, meta.result);
            }
        } catch (err) {
            console.warn("알려진 백업 파일 접근 실패:", id, err);
        }
    }

    return Array.from(found.values()).sort((a, b) =>
        String(b.modifiedTime || "").localeCompare(String(a.modifiedTime || ""))
    );
}

// 드라이브 JSON 파일 내용 읽기
async function downloadDriveBackupPayload(fileId) {
    const contentResponse = await gapi.client.drive.files.get({
        fileId,
        alt: "media",
    });

    let payload = contentResponse.result;
    if (typeof payload === "string") {
        payload = JSON.parse(payload);
    } else if (payload && typeof payload === "object" && !payload.data && contentResponse.body) {
        // 일부 환경에서는 body 문자열로만 내려옴
        try {
            payload = JSON.parse(contentResponse.body);
        } catch (_) {
            /* keep original */
        }
    }

    // body가 문자열로만 온 경우 추가 시도
    if ((!payload || typeof payload !== "object" || !payload.data) && typeof contentResponse.body === "string") {
        try {
            payload = JSON.parse(contentResponse.body);
        } catch (_) {
            /* keep */
        }
    }

    if (!payload || typeof payload !== "object") {
        throw new Error("백업 파일 형식이 올바르지 않습니다.");
    }
    if (!payload.data || typeof payload.data !== "object") {
        throw new Error("백업 파일에 지출 데이터(data)가 없습니다.");
    }
    if (!Array.isArray(payload.schema)) {
        payload.schema = Object.keys(
            Object.values(payload.data)[0] || {}
        );
    }
    return payload;
}

function summarizeExpenseMonths(dataObj) {
    return Object.keys(dataObj || {})
        .filter((month) => monthHasExpense(dataObj[month]))
        .sort();
}

// 드라이브에 있는 동명 백업 파일들을 모두 읽어 하나로 합침
async function loadAndMergeAllDriveBackups() {
    const files = await listDriveBackupFiles();
    if (!files.length) {
        return {
            files: [],
            schema: [],
            data: {},
            perFile: [],
        };
    }

    let mergedSchema = [];
    let mergedData = {};
    const perFile = [];

    for (const file of files) {
        try {
            const payload = await downloadDriveBackupPayload(file.id);
            const months = summarizeExpenseMonths(payload.data);
            perFile.push({
                id: file.id,
                modifiedTime: file.modifiedTime || "",
                months,
            });
            mergedSchema = mergeItemSchema(mergedSchema, payload.schema || []);
            mergedData = mergeExpenseData(mergedData, payload.data || {});
        } catch (err) {
            console.warn("백업 파일 읽기 실패:", file.id, err);
            perFile.push({
                id: file.id,
                modifiedTime: file.modifiedTime || "",
                months: [],
                error: err.message || String(err),
            });
        }
    }

    return {
        files,
        schema: mergedSchema,
        data: mergedData,
        perFile,
        primaryFileId: files[0].id,
    };
}

function formatDriveFileSummary(perFile) {
    if (!perFile.length) return "(파일 없음)";
    return perFile.map((f, i) => {
        const when = f.modifiedTime ? f.modifiedTime.replace("T", " ").slice(0, 16) : "?";
        const months = f.months && f.months.length ? f.months.join(",") : (f.error ? `오류:${f.error}` : "금액없음");
        return `${i + 1}) ${when} → ${months}`;
    }).join("\n");
}

// 구글 드라이브에 지출 데이터 백업하기 (기존 드라이브 데이터와 합친 뒤 저장)
async function backupDataToGoogleDrive() {
    if (!state.google.isAuthenticated) {
        alert("구글 드라이브에 백업하려면 먼저 구글 로그인을 수행해 주세요.");
        return;
    }

    // 백업 직전 화면 입력값 반영
    saveCurrentInputsToMemory();
    persistExpenseData();

    const statusBadge = document.getElementById("drive-status");
    if (statusBadge) statusBadge.textContent = "백업 진행 중...";

    try {
        // 드라이브에 있는 모든 동명 백업을 먼저 합친 뒤, 이 기기 데이터를 덮어씀
        const driveBundle = await loadAndMergeAllDriveBackups();
        let fileId = driveBundle.primaryFileId || null;

        const driveMonthsBefore = summarizeExpenseMonths(driveBundle.data);
        let mergedSchema = mergeItemSchema(driveBundle.schema || [], state.items);
        let mergedData = mergeExpenseData(driveBundle.data || {}, state.data);

        const backupPayload = {
            schema: mergedSchema,
            data: mergedData,
            lastUpdated: new Date().toISOString(),
            source: location.origin,
        };
        const fileContent = JSON.stringify(backupPayload, null, 2);
        const monthList = summarizeExpenseMonths(mergedData);
        const localMonths = summarizeExpenseMonths(state.data);

        if (fileId) {
            await gapi.client.request({
                path: `/upload/drive/v3/files/${fileId}`,
                method: "PATCH",
                params: { uploadType: "media" },
                headers: { "Content-Type": "application/json" },
                body: fileContent,
            });

            // 동명 중복 백업 파일은 휴지통으로 이동 (하나만 남김)
            for (const dup of driveBundle.files.slice(1)) {
                try {
                    await gapi.client.drive.files.update({
                        fileId: dup.id,
                        resource: { trashed: true },
                    });
                } catch (trashErr) {
                    console.warn("중복 백업 삭제 실패:", dup.id, trashErr);
                }
            }
        } else {
            const metadata = {
                name: "smart_expense_data.json",
                mimeType: "application/json",
            };
            const boundary = "314159265358979323846";
            const delimiter = "\r\n--" + boundary + "\r\n";
            const close_delim = "\r\n--" + boundary + "--";
            const multipartRequestBody =
                delimiter +
                "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
                JSON.stringify(metadata) +
                delimiter +
                "Content-Type: application/json\r\n\r\n" +
                fileContent +
                close_delim;

            await gapi.client.request({
                path: "/upload/drive/v3/files",
                method: "POST",
                params: { uploadType: "multipart" },
                headers: { "Content-Type": "multipart/related; boundary=" + boundary },
                body: multipartRequestBody,
            });
        }

        // 로컬에도 합쳐진 결과 반영
        state.items = mergedSchema;
        state.data = mergedData;
        persistLocalMirror();
        await pushSharedStore();
        renderAll();
        updateCharts();

        const keptId = fileId || "(새 파일)";
        alert(
            "구글 드라이브 백업 완료!\n\n" +
            `이 기기 월: ${localMonths.length ? localMonths.join(", ") : "(없음)"}\n` +
            `합친 뒤 저장된 월: ${monthList.length ? monthList.join(", ") : "(금액 있는 월 없음)"}\n` +
            `남긴 파일 ID: ${keptId}\n` +
            (driveBundle.files.length > 1
                ? `중복 ${driveBundle.files.length - 1}개를 휴지통으로 옮겼습니다.\n`
                : "") +
            "파일명: smart_expense_data.json\n\n" +
            "드라이브에 파일이 2개면, 위 ID가 아닌 쪽을 지우세요."
        );
    } catch (err) {
        console.error("구글 드라이브 백업 도중 오류 발생:", err);
        alert("백업 실패: " + (err.result?.error?.message || err.message));
    } finally {
        updateGoogleLoginUI();
    }
}

// 구글 드라이브에서 데이터 복원하기 (로컬과 합치기 - 6월 등 과거 월 복구용)
async function restoreDataFromGoogleDrive() {
    if (!state.google.isAuthenticated) {
        alert("구글 드라이브에서 복원하려면 먼저 구글 로그인을 수행해 주세요.");
        return;
    }

    // 예전 drive.file 권한으로 로그인한 상태면 복원 전에 재로그인 강제
    if (localStorage.getItem("google_drive_scope") !== "drive") {
        alert(
            "드라이브 권한이 예전 버전입니다.\n\n" +
            "로그아웃 후 다시 구글 로그인해서\n" +
            "'Google Drive' 접근을 허용해 주세요.\n" +
            "(앱이 만든 파일만이 아니라 드라이브의 백업 JSON을 찾습니다)"
        );
        handleGoogleSignout();
        return;
    }

    if (!confirm(
        "구글 드라이브 백업을 가져와 현재 데이터와 합칠까요?\n\n" +
        "같은 달이 있으면 금액이 더 큰 쪽을 남깁니다.\n" +
        "(지금 로컬의 7월 데이터는 유지되고, 드라이브의 6월이 있으면 추가됩니다)"
    )) {
        return;
    }

    const statusBadge = document.getElementById("drive-status");
    if (statusBadge) statusBadge.textContent = "복원 진행 중...";

    try {
        const driveBundle = await loadAndMergeAllDriveBackups();
        if (!driveBundle.files.length) {
            const reauth = confirm(
                "구글 드라이브에서 백업 파일을 찾지 못했습니다.\n\n" +
                "지금 바로 구글 권한을 다시 받을까요?\n" +
                "(로그인 화면에서 Google Drive 접근을 꼭 허용하세요)\n\n" +
                "취소하면 안내만 닫습니다."
            );
            if (reauth) {
                localStorage.removeItem("google_access_token");
                localStorage.removeItem("google_token_expiry");
                localStorage.removeItem("google_drive_scope");
                state.google.accessToken = null;
                state.google.isAuthenticated = false;
                if (typeof gapi !== "undefined" && gapi.client) gapi.client.setToken(null);
                updateGoogleLoginUI();
                handleGoogleAuth();
            }
            return;
        }

        const restoredPayload = {
            schema: driveBundle.schema,
            data: driveBundle.data,
        };
        const beforeMonths = summarizeExpenseMonths(state.data);
        const driveMonths = summarizeExpenseMonths(restoredPayload.data);

        applyRestoredData(restoredPayload, { merge: true });

        const afterMonths = summarizeExpenseMonths(state.data);
        const added = afterMonths.filter((m) => !beforeMonths.includes(m));
        const fileSummary = formatDriveFileSummary(driveBundle.perFile);

        alert(
            "드라이브 복원(합치기) 완료!\n\n" +
            `찾은 백업 파일: ${driveBundle.files.length}개\n` +
            `${fileSummary}\n\n` +
            `합친 드라이브 월: ${driveMonths.length ? driveMonths.join(", ") : "(금액 없음)"}\n` +
            `새로 추가된 월: ${added.length ? added.join(", ") : "(없음)"}\n` +
            `현재 보유 월: ${afterMonths.length ? afterMonths.join(", ") : "(없음)"}\n\n` +
            (driveMonths.includes("2026-06")
                ? "6월 데이터가 합쳐졌습니다."
                : "주의: 앱이 읽을 수 있는 백업에는 6월 금액이 없습니다.\n" +
                  "모바일에서 새로고침 후 다시 '드라이브 백업'을 눌러 주세요.")
        );
    } catch (err) {
        console.error("구글 드라이브 복원 도중 오류 발생:", err);
        alert("복원 실패: " + (err.result?.error?.message || err.message));
    } finally {
        updateGoogleLoginUI();
    }
}

// 가져온 백업본을 브라우저 로컬 데이터베이스에 탑재
// merge=true 이면 기존 로컬과 합침(월별 합계가 큰 쪽 유지)
function applyRestoredData(payload, { merge = false } = {}) {
    if (!payload || typeof payload !== "object") return;

    if (merge) {
        state.items = mergeItemSchema(state.items, payload.schema || []);
        state.data = mergeExpenseData(state.data, payload.data || {});
    } else {
        state.items = Array.isArray(payload.schema) ? payload.schema : state.items;
        state.data = payload.data && typeof payload.data === "object" ? payload.data : {};
    }

    persistLocalMirror();
    pushSharedStore();
    renderAll();
    updateCharts();
    showSaveStatus("드라이브 데이터 반영 완료");
}

// 드라이브에서 다운로드한 JSON / 화면의 JSON을 직접 합치기
async function handleImportJsonFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;

    try {
        const text = await file.text();
        let payload = JSON.parse(text);

        // { data: { "2026-06": {...} } } 또는 월 객체만 붙여넣은 경우 모두 허용
        if (!payload.data && payload["2026-06"]) {
            payload = { schema: Object.keys(payload["2026-06"]), data: payload };
        }
        if (!payload.data && typeof payload === "object") {
            const maybeMonths = Object.keys(payload).filter((k) => /^\d{4}-\d{2}$/.test(k));
            if (maybeMonths.length) {
                payload = { schema: [], data: payload };
            }
        }
        if (!payload.data || typeof payload.data !== "object") {
            throw new Error("JSON에 data(월별 지출) 객체가 없습니다.");
        }

        const before = summarizeExpenseMonths(state.data);
        const incoming = summarizeExpenseMonths(payload.data);
        applyRestoredData(payload, { merge: true });
        const after = summarizeExpenseMonths(state.data);
        const added = after.filter((m) => !before.includes(m));

        alert(
            "JSON 가져오기 완료!\n\n" +
            `파일에 있던 월: ${incoming.length ? incoming.join(", ") : "(금액 없음)"}\n` +
            `새로 추가된 월: ${added.length ? added.join(", ") : "(없음)"}\n` +
            `현재 보유 월: ${after.length ? after.join(", ") : "(없음)"}`
        );
    } catch (err) {
        console.error("JSON 가져오기 실패:", err);
        alert("JSON 가져오기 실패: " + err.message);
    }
}

// ==========================================================================
// 9. 테이블 행 드래그 앤 드롭(Drag & Drop) 순서 정렬
// ==========================================================================

// 드래그 핸들 클릭 여부를 판별하기 위한 글로벌 상태 플래그
let isHandleClicked = false;

// 지출 항목 테이블 행들의 HTML5 드래그 앤 드롭 리스너 바인딩
function bindExpenseDragEvents() {
    const tableBody = document.getElementById("expense-list");
    if (!tableBody) return;

    const rows = tableBody.querySelectorAll("tr");
    let draggedRow = null;

    rows.forEach(row => {
        const handle = row.querySelector(".drag-handle");

        // 1) 드래그 핸들을 누르는 시점에만 드래그를 허용하기 위해 플래그 설정 (인풋 필드 오작동 차단)
        if (handle) {
            handle.addEventListener("mousedown", () => {
                isHandleClicked = true;
            });
            handle.addEventListener("mouseup", () => {
                isHandleClicked = false;
            });
            
            // 모바일 및 터치 디바이스 오작동 대응
            handle.addEventListener("touchstart", () => {
                isHandleClicked = true;
            }, { passive: true });
            handle.addEventListener("touchend", () => {
                isHandleClicked = false;
            }, { passive: true });
        }

        // 2) dragstart: 드래그 제스처가 시작될 때
        row.addEventListener("dragstart", (e) => {
            // 드래그 핸들을 클릭해 잡은 상태가 아니라면 브라우저의 기본 드래그 동작을 원천 차단
            if (!isHandleClicked) {
                e.preventDefault();
                return;
            }
            draggedRow = row;
            row.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", row.getAttribute("data-item-name"));
        });

        // 3) dragover: 다른 행 위로 마우스가 지나갈 때
        row.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (row === draggedRow) return;

            // 마우스 포인터의 세로 위치를 체크해 드롭 삽입 가이드를 시각화
            const rect = row.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            
            if (e.clientY < midpoint) {
                row.classList.add("drag-over");
            } else {
                row.classList.remove("drag-over");
            }
        });

        // 4) dragleave: 마우스가 행 영역을 벗어날 때
        row.addEventListener("dragleave", () => {
            row.classList.remove("drag-over");
        });

        // 5) drop: 특정 행 위에 행을 떨어뜨렸을 때
        row.addEventListener("drop", (e) => {
            e.preventDefault();
            row.classList.remove("drag-over");
            
            if (!draggedRow || draggedRow === row) return;

            const draggedName = draggedRow.getAttribute("data-item-name");
            const targetName = row.getAttribute("data-item-name");

            const draggedIndex = state.items.indexOf(draggedName);
            const targetIndex = state.items.indexOf(targetName);

            if (draggedIndex !== -1 && targetIndex !== -1) {
                // 현재 테이블에 적힌 최신 금액들을 메모리에 동기화
                saveCurrentInputsToMemory();

                // 배열 내 인덱스 재배치 (기존 위치 삭제 후 새로운 타겟 인덱스에 삽입)
                state.items.splice(draggedIndex, 1);
                state.items.splice(targetIndex, 0, draggedName);

                // 순서 스키마 로컬 + 공유 저장소 보존
                localStorage.setItem("expense_items_schema", JSON.stringify(state.items));
                pushSharedStore();
                
                // 테이블 리렌더링 및 차트 갱신
                renderAll();
                updateCharts();
                
                showSaveStatus("항목 순서가 변경되었습니다.");
            }
        });

        // 6) dragend: 드래그 액션이 취소되거나 끝났을 때
        row.addEventListener("dragend", () => {
            row.classList.remove("dragging");
            rows.forEach(r => {
                r.classList.remove("drag-over");
            });
            draggedRow = null;
            isHandleClicked = false; // 플래그 안전 해제
        });
    });
}


