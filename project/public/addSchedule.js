function SetRepeat(){
  const target = document.getElementById('RepeatStatus')

  if (target.value == 1){
    target.textContent = '반복';
    target.value = 2;
    console.log(target.value);
  }
  else{
    target.textContent = '한번 실행';
    target.value = 1;
    console.log(target.value);
  }
}

function SetTime(value){
  const target = document.getElementById('TimeStatus')
  console.log(value);
}

