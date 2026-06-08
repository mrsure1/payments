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
    renderAll();
    initChartInstances();
    updateCharts();
    setupEventListeners();
    
    // Lucide 아이콘 활성화
    lucide.createIcons();
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
        
        // 해당 항목의 금액 (없으면 0 또는 빈 칸으로 노출할 수 있으나, 0원으로 기본값 설정)
        const amount = monthData[item] !== undefined ? monthData[item] : 0;
        const formattedAmount = formatNumberWithCommas(amount);
        
        tr.innerHTML = `
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
