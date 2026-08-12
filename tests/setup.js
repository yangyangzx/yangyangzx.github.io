/**
 * 测试环境初始化
 * 模拟浏览器 DOM 环境
 */

// 模拟 DOM 元素
global.document = {
  getElementById: (id) => ({
    id,
    value: '',
    textContent: '',
    className: '',
    style: {},
    classList: {
      add: () => {},
      remove: () => {},
      toggle: () => {},
      contains: () => false
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => []
  }),
  querySelector: () => null,
  querySelectorAll: () => []
};

// 模拟 localStorage
global.localStorage = {
  _data: {},
  getItem: (key) => this._data[key] || null,
  setItem: (key, value) => { this._data[key] = String(value); },
  removeItem: (key) => { delete this._data[key]; },
  clear: () => { this._data = {}; }
};

// 模拟 console
global.console = {
  log: () => {},
  warn: () => {},
  error: () => {}
};
