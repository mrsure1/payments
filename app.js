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
document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initDateTime();
    loadLocalStorage();
    loadGoogleConfig(); // 구글 API 연동 설정 불러오기
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
        state.items = JSON.parse(savedItems);
    } else {
        state.items = [...DEFAULT_EXPENSE_ITEMS];
        localStorage.setItem("expense_items_schema", JSON.stringify(state.items));
    }
    
    // 2) 월별 지출 데이터 로드
    const savedData = localStorage.getItem("expense_data");
    if (savedData) {
        state.data = JSON.parse(savedData);
    } else {
        state.data = {};
        localStorage.setItem("expense_data", JSON.stringify(state.data));
    }
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
    
    state.items.forEach((item) => {
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
            <td><span class="expense-item-name">${escapeHtml(item)}</span></td>
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
    
    // 새로 렌더링된 요소에 대해 Lucide 아이콘 및 지출 입력 이벤트 핸들링 바인딩
    lucide.createIcons();
    bindExpenseInputs();
    bindExpenseDragEvents(); // 드래그 앤 드롭 정렬 이벤트 바인딩 추가
}

// 과거에 저장한 월별 내역 리스트 렌더링
function renderHistoryList() {
    const historyContainer = document.getElementById("history-list");
    if (!historyContainer) return;
    
    historyContainer.innerHTML = "";
    
    // 월별 데이터를 정렬하여 리스트 출력 (내림차순)
    const sortedMonths = Object.keys(state.data).sort().reverse();
    
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
            
            // 입력할 때마다 실시간으로 메모리 데이터에도 임시 업데이트 (편의성 향상)
            saveCurrentInputsToMemory();
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
            monthPicker.showPicker(); // 브라우저 빌트인 월 선택기 호출
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
}

// ==========================================================================
// 5. 비즈니스 로직 연산 및 데이터 조작 함수
// ==========================================================================

// 현재 화면의 모든 Input 값을 객체 구조로 수집하여 상태 메모리에 임시 기록합니다.
function saveCurrentInputsToMemory() {
    const inputs = document.querySelectorAll(".expense-input");
    const monthData = {};
    
    inputs.forEach(input => {
        const item = input.getAttribute("data-item");
        const rawValue = input.value.replace(/,/g, "");
        const numValue = parseInt(rawValue, 10) || 0;
        monthData[item] = numValue;
    });
    
    state.data[state.currentMonth] = monthData;
}

// 현재 입력 데이터를 LocalStorage에 영구 저장합니다.
function saveCurrentInputsToStorage() {
    saveCurrentInputsToMemory();
    
    // 로컬 스토리지 동기화
    localStorage.setItem("expense_data", JSON.stringify(state.data));
    
    // 저장 알림 표시 및 피드백 애니메이션
    showSaveStatus("데이터가 성공적으로 저장되었습니다!");
    
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
    // 1) 전환 전 현재 입력 내용 메모리에 자동 적용
    saveCurrentInputsToMemory();
    
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
    localStorage.setItem("expense_data", JSON.stringify(state.data));
    
    // 전체 갱신
    renderAll();
    updateCharts();
}

// 특정 달의 저장 데이터 통째로 삭제
function deleteHistoryMonth(month) {
    if (state.data[month]) {
        delete state.data[month];
        localStorage.setItem("expense_data", JSON.stringify(state.data));
        
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
                backgroundColor: [
                    '#6366f1', '#a855f7', '#ec4899', '#f43f5e', 
                    '#10b981', '#f59e0b', '#3b82f6', '#06b6d4'
                ],
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
    const monthData = state.data[state.currentMonth] || {};
    const labels = [];
    const values = [];
    
    Object.keys(monthData).forEach(item => {
        const val = monthData[item] || 0;
        if (val > 0) { // 0원인 항목은 시각화 왜곡 방지를 위해 노출 안함
            labels.push(item);
            values.push(val);
        }
    });

    const noDataMsg = document.getElementById("no-data-msg");
    const ratioCanvas = document.getElementById("ratioChart");

    if (values.length === 0) {
        // 지출 내역이 아예 없는 경우 대체 문구 출력
        if (noDataMsg) noDataMsg.classList.remove("hidden");
        if (ratioCanvas) ratioCanvas.style.opacity = "0";
    } else {
        if (noDataMsg) noDataMsg.classList.add("hidden");
        if (ratioCanvas) ratioCanvas.style.opacity = "1";
        
        state.charts.ratio.data.labels = labels;
        state.charts.ratio.data.datasets[0].data = values;
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
        state.google.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: state.google.clientId,
            scope: 'https://www.googleapis.com/auth/drive.file', // 앱이 생성한 파일에만 안전하게 접근 가능
            callback: (response) => {
                if (response.error !== undefined) {
                    alert("구글 로그인 승인 중 오류가 발생했습니다: " + response.error);
                    return;
                }
                state.google.accessToken = response.access_token;
                state.google.isAuthenticated = true;
                
                // 백업/복원 원활한 가동을 위한 토큰 헤더 셋업
                gapi.client.setToken(response);
                
                updateGoogleLoginUI();
                showSaveStatus("구글 드라이브 연동에 성공했습니다.");
            },
        });
        
        console.log("구글 API 및 GIS SDK 초기화가 완료되었습니다.");
    } catch (err) {
        console.error("구글 API 초기화 중 예외 발생:", err);
    }
}

// 구글 로그인 권한 인증 실행
function handleGoogleAuth() {
    if (!state.google.clientId) {
        alert("먼저 'API 연동 설정' 버튼을 눌러 구글 클라우드에서 발급받은 Client ID를 입력하세요.");
        const settingsModal = document.getElementById("api-settings-modal");
        if (settingsModal) settingsModal.classList.remove("hidden");
        return;
    }

    if (!state.google.tokenClient) {
        initGoogleApi().then(() => {
            if (state.google.tokenClient) {
                state.google.tokenClient.requestAccessToken({ prompt: 'consent' });
            } else {
                alert("구글 API SDK 초기화가 실패했습니다. API 설정을 확인하세요.");
            }
        });
    } else {
        // 이미 토큰 클라이언트가 있으면 바로 로그인 요청 창 띄움
        state.google.tokenClient.requestAccessToken({ prompt: 'consent' });
    }
}

// 구글 로그아웃
function handleGoogleSignout() {
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
            driveStatus.textContent = "연결됨";
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

// 구글 드라이브에 지출 데이터 백업하기 (JSON 파일 업로드)
async function backupDataToGoogleDrive() {
    if (!state.google.isAuthenticated) {
        alert("구글 드라이브에 백업하려면 먼저 구글 로그인을 수행해 주세요.");
        return;
    }

    // 로드 중임을 알리는 상태 표시
    const statusBadge = document.getElementById("drive-status");
    if (statusBadge) statusBadge.textContent = "백업 진행 중...";

    try {
        // 1) 드라이브에 이미 'smart_expense_data.json' 파일이 존재하는지 검색
        const response = await gapi.client.drive.files.list({
            q: "name = 'smart_expense_data.json' and trashed = false",
            fields: 'files(id, name)',
            spaces: 'drive'
        });

        const files = response.result.files;
        
        // 백업할 전체 데이터 수집
        const backupPayload = {
            schema: state.items,
            data: state.data,
            lastUpdated: new Date().toISOString()
        };

        const fileContent = JSON.stringify(backupPayload, null, 2);
        
        let fileId = null;
        if (files && files.length > 0) {
            fileId = files[0].id;
        }

        if (fileId) {
            // 2-A) 파일이 이미 존재하면 덮어쓰기 (Update)
            await gapi.client.request({
                path: `/upload/drive/v3/files/${fileId}`,
                method: 'PATCH',
                params: { uploadType: 'media' },
                headers: { 'Content-Type': 'application/json' },
                body: fileContent
            });
            console.log("구글 드라이브에 파일이 업데이트되었습니다. ID:", fileId);
        } else {
            // 2-B) 파일이 존재하지 않으면 새 파일 생성 (Create)
            const metadata = {
                name: 'smart_expense_data.json',
                mimeType: 'application/json'
            };

            const boundary = '314159265358979323846';
            const delimiter = "\r\n--" + boundary + "\r\n";
            const close_delim = "\r\n--" + boundary + "--";

            const multipartRequestBody =
                delimiter +
                'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
                JSON.stringify(metadata) +
                delimiter +
                'Content-Type: application/json\r\n\r\n' +
                fileContent +
                close_delim;

            await gapi.client.request({
                path: '/upload/drive/v3/files',
                method: 'POST',
                params: { uploadType: 'multipart' },
                headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
                body: multipartRequestBody
            });
            console.log("구글 드라이브에 새 백업 파일이 생성되었습니다.");
        }

        alert("모든 지출 데이터가 구글 드라이브에 안전하게 백업되었습니다!");
    } catch (err) {
        console.error("구글 드라이브 백업 도중 오류 발생:", err);
        alert("백업 실패: " + (err.result?.error?.message || err.message));
    } finally {
        updateGoogleLoginUI();
    }
}

// 구글 드라이브에서 데이터 복원하기 (JSON 파일 가져와 적용)
async function restoreDataFromGoogleDrive() {
    if (!state.google.isAuthenticated) {
        alert("구글 드라이브에서 복원하려면 먼저 구글 로그인을 수행해 주세요.");
        return;
    }

    if (!confirm("구글 드라이브에서 데이터를 복원하시겠습니까?\n주의: 복원 시 브라우저에 기록되어 있는 현재 데이터는 구글 드라이브 데이터로 완전히 덮어씌워집니다.")) {
        return;
    }

    const statusBadge = document.getElementById("drive-status");
    if (statusBadge) statusBadge.textContent = "복원 진행 중...";

    try {
        // 1) 드라이브에서 파일 검색
        const response = await gapi.client.drive.files.list({
            q: "name = 'smart_expense_data.json' and trashed = false",
            fields: 'files(id, name)',
            spaces: 'drive'
        });

        const files = response.result.files;

        if (!files || files.length === 0) {
            alert("구글 드라이브에 저장된 백업 파일('smart_expense_data.json')을 찾을 수 없습니다.");
            return;
        }

        const fileId = files[0].id;

        // 2) 파일 미디어 내용 읽기
        const contentResponse = await gapi.client.drive.files.get({
            fileId: fileId,
            alt: 'media'
        });

        const restoredPayload = contentResponse.result;

        if (!restoredPayload || !restoredPayload.schema || !restoredPayload.data) {
            // 텍스트 형태로 수신되어 수동 파싱이 필요한 경우 처리
            let parsed = restoredPayload;
            if (typeof restoredPayload === 'string') {
                parsed = JSON.parse(restoredPayload);
            }
            applyRestoredData(parsed);
        } else {
            applyRestoredData(restoredPayload);
        }

        alert("구글 드라이브로부터 데이터를 성공적으로 가져와 복원하였습니다!");
    } catch (err) {
        console.error("구글 드라이브 복원 도중 오류 발생:", err);
        alert("복원 실패: " + (err.result?.error?.message || err.message));
    } finally {
        updateGoogleLoginUI();
    }
}

// 가져온 백업본을 브라우저 로컬 데이터베이스에 탑재
function applyRestoredData(payload) {
    // 로컬 상태 적용
    state.items = payload.schema;
    state.data = payload.data;
    
    // 로컬 스토리지에 즉시 동기화
    localStorage.setItem("expense_items_schema", JSON.stringify(state.items));
    localStorage.setItem("expense_data", JSON.stringify(state.data));
    
    // 화면 전체 강제 갱신
    renderAll();
    updateCharts();
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

                // 순서 스키마 로컬 스토리지 보존
                localStorage.setItem("expense_items_schema", JSON.stringify(state.items));
                
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


