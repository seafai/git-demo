"use strict";
const status = document.getElementById("copy-status");
let timer;
document.querySelectorAll("[data-copy]").forEach(button => {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      status.textContent = "地址已复制，粘贴到浏览器地址栏打开。";
    } catch {
      status.textContent = "请手动复制：" + button.dataset.copy;
    }
    clearTimeout(timer);
    timer = setTimeout(() => { status.textContent = ""; }, 5500);
  });
});
