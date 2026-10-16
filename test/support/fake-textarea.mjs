// A textarea stand-in for Node: its value, selection and the events the
// binding listens to, raised the way a browser raises them for typing.
export class FakeTextarea extends EventTarget {
  constructor(value = '') {
    super();
    this.value = value;
    this.scrollHeight = 100;
    this.readOnly = false;
  }

  // As in a browser, setting the value puts the caret at the end.
  get value() {
    return this.text;
  }

  set value(text) {
    this.text = text;
    this.selectionStart = text.length;
    this.selectionEnd = text.length;
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  replace(start, end, text) {
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    this.setSelectionRange(start + text.length, start + text.length);
    this.dispatchEvent(new Event('input'));
  }

  type(index, text) {
    this.replace(index, index, text);
  }

  compose(text, index = this.value.length) {
    this.dispatchEvent(new Event('compositionstart'));
    this.type(index, text);
    this.dispatchEvent(new Event('compositionend'));
  }

  key(options) {
    const event = Object.assign(new Event('keydown', { cancelable: true }), options);
    this.dispatchEvent(event);
    return event;
  }

  beforeInput(inputType) {
    const event = Object.assign(new Event('beforeinput', { cancelable: true }), { inputType });
    this.dispatchEvent(event);
    return event;
  }
}
