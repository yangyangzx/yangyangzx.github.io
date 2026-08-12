/**
 * 状态管理向后兼容层
 * 在完全迁移到新的 store.js 之前，保持现有代码正常工作
 */

(function() {
  // 获取 AppStore（如果存在）
  var AppStore = window.AppStore;
  
  // 如果 AppStore 不存在，使用全局变量
  if (!AppStore) {
    console.warn('[State Compat] AppStore not found, using global variables');
    return;
  }
  
  // 向后兼容：将全局 logs 指向 store 的 logs
  if (typeof logs === 'undefined') {
    Object.defineProperty(window, 'logs', {
      get: function() { return AppStore.logs.get(); },
      set: function(value) { 
        console.warn('[State Compat] Direct assignment to logs is deprecated, use AppStore.logs.add()');
      },
      enumerable: true,
      configurable: false
    });
  }
  
  // 向后兼容：window._lastCalc 指向 store
  if (typeof window._lastCalc === 'undefined') {
    Object.defineProperty(window, '_lastCalc', {
      get: function() { return AppStore.calc.get(); },
      set: function(value) { AppStore.calc.set(value); },
      enumerable: true,
      configurable: true
    });
  }
  
  // 提供快捷方法
  window.loadLogs = function() {
    return AppStore.logs.load();
  };
  
  window.saveLogs = function() {
    return AppStore.logs.save();
  };
  
  console.log('[State Compat] Backward compatibility layer initialized');
})();
