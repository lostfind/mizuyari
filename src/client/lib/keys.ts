// 키 입력 판정. 일본어 IME 의 변환 확정 Enter 는 submit 으로 보지 않는다.

/** 변환 중이 아닌 Enter 인지. Safari 는 확정 Enter 에서 isComposing=false 로 오므로 keyCode 229 도 본다. */
export function isSubmitEnter(e: KeyboardEvent): boolean {
  return e.key === "Enter" && !e.isComposing && e.keyCode !== 229;
}
