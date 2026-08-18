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
  if (block.hasAttribute(MARK)) return;

  // 定位"消息行"容器:向上走到列表边界(父元素子节点>3 或 body)前一层。
  // 关键:绝不把图片插进消息列表容器/body——否则会变成列表末尾的游离元素,
  // 把对话 UI 顶起来并产生滚动条(拖拽图片进输入框时文本直接挂在列表下的情况)。
  var host = block;
  var climbed = false;
  for (var i = 0; i < 8; i++) {
    var parent = host.parentElement;
    if (!parent || parent === document.body) break;
    if (parent.childElementCount > 3) break;
    host = parent;
    climbed = true;
  }
  if (!climbed || host === document.body) return; // 无可挂载的行容器 → 跳过
  if (host.querySelector("[" + MARK + "]") !== null) return; // 该行已有预览

  block.setAttribute(MARK, "1");
  for (var j = matches.length - 1; j >= 0; j--) {
    var img = document.createElement("img");
    img.setAttribute(MARK, "1");
    img.src = ROUTE + "?p=" + encodeURIComponent(matches[j]);
    img.alt = "图片预览";
    img.style.cssText = "max-width:min(360px,100%);max-height:420px;border-radius:8px;display:block;margin:4px 0 6px;object-fit:contain;cursor:zoom-in;";
    img.addEventListener("error", function () {
      // 图片加载失败:移除自身,静默降级(块标记保留,避免无限重试)
      this.remove();
    });
    img.addEventListener("click", function () {
      openLightbox(this.src, this.alt);
    });
    host.insertBefore(img, host.firstChild);
  }
}

/**
 * 灯箱:点击缩略图 → 全屏大图;点任意处或按 Esc 关闭。
 */
function openLightbox(src, alt) {
  var overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center;z-index:2147483000;cursor:zoom-out;";
  var big = document.createElement("img");
  big.src = src;
  big.alt = alt || "图片预览";
  big.style.cssText = "max-width:92vw;max-height:92vh;object-fit:contain;border-radius:4px;box-shadow:0 8px 40px rgba(0,0,0,0.5);";
  var close = function () {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  var onKey = function (e) {
    if (e.key === "Escape") close();
  };
  big.addEventListener("error", close);
  overlay.addEventListener("click", close);
  overlay.appendChild(big);
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey, true);
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
