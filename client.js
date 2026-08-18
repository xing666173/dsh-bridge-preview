/**
 * dsh-bridge-preview — 浏览器端(client half,手写 bundle,无构建依赖)。
 *
 * 观察用户气泡里 dsh-tool-vision 的桥接提示文本
 *   [User sent an image..., exported to: <path>...]
 * 提取本地图片路径,在气泡内文本块上方插入同源 <img> 预览。
 *
 * 纯展示层:不修改任何持久化消息、不碰插槽系统、不影响模型请求。
 *
 * 健壮性设计:
 *  - 去重键 = 消息自己的文本块元素(而非向上找的祖先容器)——避免不同消息
 *    走到同一祖先被误判"已处理"而跳过;
 *  - MutationObserver + 2s 周期兜底扫描(观察器被 HMR 释放后仍能恢复);
 *  - 图片加载失败(onerror)自动移除,静默降级。
 */
window.__ModuleLoader__.load({ id: "dsh-bridge-preview", factory: function (require) {
"use strict";
var name = "dsh-bridge-preview";
var inject = [];
var ROUTE = "/plugins/dsh-bridge-preview/image";
var HINT_RE = /exported to:\s*("[^"]+"|'[^']+'|[A-Za-z]:[\\/][^\s\]]+?\.(?:png|jpe?g|webp|gif|avif|bmp))/gi;
var MARK = "data-dshbp";
var pendingTimer = null;
var intervalTimer = null;

function extractPath(m) {
  var s = m[1];
  if (s.length >= 2) {
    var first = s[0];
    var last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) s = s.slice(1, -1);
  }
  return s;
}

function processTextNode(textNode) {
  var data = textNode.data;
  if (typeof data !== "string" || data.indexOf("exported to:") === -1) return;
  var matches = [];
  var seen = {};
  var m;
  HINT_RE.lastIndex = 0;
  while ((m = HINT_RE.exec(data)) !== null) {
    var path = extractPath(m);
    if (path in seen) continue;
    seen[path] = true;
    matches.push(path);
  }
  if (matches.length === 0) return;

  var block = textNode.parentElement;
  if (!block) return;
  // 去重键 = 文本块自身:已处理过的块直接跳过(React 重建块后标记消失,会重新处理)
  if (block.hasAttribute(MARK)) return;
  block.setAttribute(MARK, "1");

  var container = block.parentElement;
  if (!container) return;
  var ref = block;
  for (var j = 0; j < matches.length; j++) {
    var img = document.createElement("img");
    img.setAttribute(MARK, "1");
    img.src = ROUTE + "?p=" + encodeURIComponent(matches[j]);
    img.alt = "图片预览";
    img.style.cssText = "max-width:min(360px,100%);max-height:420px;border-radius:8px;display:block;margin:4px 0 6px;object-fit:contain;";
    img.addEventListener("error", function () {
      // 图片加载失败:移除自身,静默降级(块标记保留,避免无限重试)
      this.remove();
    });
    container.insertBefore(img, ref);
    ref = img;
  }
}

function scan() {
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      if (!node.data || node.data.indexOf("exported to:") === -1) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  var nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (var i = 0; i < nodes.length; i++) processTextNode(nodes[i]);
}

function apply(ctx) {
  ctx.effect(function () {
    scan();
    var observer = new MutationObserver(function () {
      if (pendingTimer !== null) return;
      pendingTimer = setTimeout(function () {
        pendingTimer = null;
        scan();
      }, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    // 兜底:观察器被 HMR 释放或事件丢失时,周期重扫仍能补上预览
    intervalTimer = setInterval(function () { scan(); }, 2000);
    return function () {
      observer.disconnect();
      if (pendingTimer !== null) { clearTimeout(pendingTimer); pendingTimer = null; }
      if (intervalTimer !== null) { clearInterval(intervalTimer); intervalTimer = null; }
    };
  }, "dsh-bridge-preview: preview observer");
}

return { apply: apply, inject: inject, name: name };
}});
