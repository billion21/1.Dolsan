import data1 from './data.js';

const modal_selected_data = new Set([]);

function createRow(data) {
  const tableBody = document.getElementById('scheduleList');
  tableBody.innerHTML = '';
  
  data.SENACT_INFO_SCHEDULE.forEach((item, index) => {
    //행 생성
    const row = document.createElement('tr');
    row.id = `row${item.NO}`;
    row.value = item;

    //체크박스 생성 및 추가
    const checkboxCell = document.createElement('td')
    const checkboxInput = document.createElement('input');
    checkboxInput.type = 'checkbox';
    checkboxInput.name = 'selected';
    checkboxInput.value = item;
    checkboxCell.appendChild(checkboxInput);
    row.appendChild(checkboxCell);

    //체크박스 선택
    checkboxInput.addEventListener('change',()=>{
      if (checkboxInput.checked = true) {
        // 데이터 반환
        modal_selected_data.add(item);
        //console.log(modal_selected_data);
      } 
      else{
        modal_selected_data.delete(item);
        //console.log(modal_selected_data);
      }
    })

    //번호 추가
    const NoCell = document.createElement('td');
    NoCell.textContent = index;
    row.appendChild(NoCell);

    //등록일
    const AddDTCell = document.createElement('td');
    AddDTCell.textContent = item.REG_DT;
    row.appendChild(AddDTCell);

    //예약 동작 시간
    const ReservedCell = document.createElement('td');
    ReservedCell.textContent = item.SENACT_RESERVE_DT;
    row.appendChild(ReservedCell);

    //토글 추가 - 셀 생성
    const ToggleCell = document.createElement('td');
    
    //토글 추가 - label (배경)
    const ToggleLabel = document.createElement('label');
    ToggleLabel.for = `toggle${index}`;
    ToggleLabel.className = 'toggleSwitch';
    ToggleLabel.style.margin = '0 auto';

    ToggleCell.appendChild(ToggleLabel);

    //토글 추가 - input
    const ToggleInput = document.createElement('input');
    ToggleInput.type = 'checkbox';
    ToggleInput.id = item.NO;
    ToggleInput.style.display = 'none';
    ToggleInput.value = `toggle${index}`;
    ToggleLabel.appendChild(ToggleInput);

    //토글 추가 - span (버튼)
    const ToggleSpan = document.createElement('span');
    ToggleSpan.className = 'toggleButton';
    ToggleLabel.appendChild(ToggleSpan);

    row.appendChild(ToggleCell);
    tableBody.appendChild(row);
    
    if (item.SENACT_ENABLE == 1) {
      // 사용 일 경우 표시
      ToggleInput.checked = true;
      ToggleLabel.classList.add('checkedSwitch');
      ToggleSpan.classList.add('checkedButton');
    }


    // 토글 이벤트
    ToggleInput.addEventListener('change', ()=>{
      if (ToggleInput.checked == true) {
        // 체크되었을 때의 동작
        ToggleLabel.classList.add('checkedSwitch');
        ToggleSpan.classList.add('checkedButton');
        data.SENACT_INFO_SCHEDULE.find((value)=>value === item).SENACT_ENABLE = 1;
        //console.log(`${ToggleInput.id}번 토글: ` + data.SENACT_INFO_SCHEDULE.find((value)=>value === item).SENACT_ENABLE + '  데이터 수정 요청');
      } 
      else {
        // 체크가 해제되었을 때의 동작
        ToggleLabel.classList.remove('checkedSwitch');
        ToggleSpan.classList.remove('checkedButton');
        data.SENACT_INFO_SCHEDULE.find((value)=>value === item).SENACT_ENABLE = 0
        //console.log(`${ToggleInput.id}번 토글: ` + data.SENACT_INFO_SCHEDULE.find((value)=>value === item).SENACT_ENABLE+ '  데이터 수정 요청');
      }});
  });
}





// 모달 타이틀
function modalTitle(data){
  const modalTitle = document.getElementById('modalTitle');
  const title = document.createElement('h2');
  title.textContent = `${data.SENACT_INFO_SCHEDULE[0].SENACT_ID} 번 채집망`;
  modalTitle.appendChild(title);
}

window.DeleteData = function DeleteData(){
    modal_selected_data.forEach((item, index)=>{
      data.SENACT_INFO_SCHEDULE.splice(data.SENACT_INFO_SCHEDULE.findIndex((value)=>value == item), 1);
      const rowToRemove = document.getElementById(`row${item.NO}`);
      rowToRemove.remove();
      //console.log(data.SENACT_INFO_SCHEDULE);
      modal_selected_data.delete(item);
    })
  }
  
window.SaveData = function SaveData(){
  console.log('데이터 추가/수정 요청 : ' + data);}


const data = data1;

createRow(data);
modalTitle(data);

