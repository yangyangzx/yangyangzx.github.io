// 应用版本 - 每次更新后递增，用于缓存清除
// 完整 changelog 见 CHANGELOG.md（v5.6.35 起从本文件迁出）
var APP_VERSION = '5.6.36';

(function () {
  var el = document.getElementById('navVersion');
  if (el) { el.textContent = 'v' + APP_VERSION; }
})();
