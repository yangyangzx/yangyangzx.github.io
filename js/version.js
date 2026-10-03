// 应用版本 - 每次更新后递增，用于缓存清除
// 5.6：UI/UX 审计全量修复（toast 层级、弹窗 a11y、原生对话框替换、指标说明可达性、
//      信息架构去重与命名统一、内联样式 token 化）
// 5.6.1：编辑簿记一致性收口（新增 utils.syncCloseBookkeeping，保证
//        sum(closes[].ratio)===closedRatio；分批比例越界拦截；弹窗内切换平仓类型联动
//        比例行显隐）+ isClosedTrade 历史重复定义删除 + 主题手动标记移除与
//        theme-color 同步 + nav active 边框插值修正 + stats 死代码删除
var APP_VERSION = '5.6.1';
