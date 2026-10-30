// Firefox rendering of the shipped visuals module against a minimal Zen DOM fixture.
// Native behavior below models Zen 1.23.4b; this does not run privileged Zen chrome.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { firefox } = require(path.join(process.env.ZSC_BROWSER_DEPS, "node_modules/playwright"));
const source = fs.readFileSync(path.join(__dirname, "../../zen-safe-close.uc.js"), "utf8");
const start = source.lastIndexOf("(() => {", source.indexOf('const ATTR = "data-zsc-unloaded"'));
const code = source.slice(start, source.indexOf("\n(() => {", start + 1));

(async () => {
  const browser = await firefox.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.setContent(`<style>
      .tabbrowser-tab { display:flex; height:36px; width:260px }
      .tab-stack,.tab-content { display:flex; align-items:center; flex:1; min-width:0 }
      .tab-label-container { display:flex; flex-direction:column; flex:1; min-width:0; height:100%; justify-content:center }
      .tab-reset-pin-button { display:flex; position:relative; width:24px; height:24px }
      .tab-icon-stack { width:16px; margin-inline-end:8px }
      .tabbrowser-tab:not([zen-pinned-changed="true"]) .tab-reset-pin-button { display:none }
      .tab-reset-pin-button::after { content:""; width:2.5px; height:16px; background:gray; transform:rotate(15deg) }
      .tab-reset-pin-button:hover::after { opacity:0 }
      .tabbrowser-tab[hidden] { display:none }
    </style><div id="tabbrowser-tabs"><zen-folder id="folder"><div id="box"></div></zen-folder><div id="outside"></div></div>`);
    await page.evaluate(() => {
      document.documentElement.setAttribute("zen-sidebar-expanded", "true");
      function row(id, parent, attrs = []) {
        const tab = document.createElement("div"); tab.id = id; tab.className = "tabbrowser-tab";
        for (const attr of attrs) tab.setAttribute(attr, "true");
        tab.innerHTML = '<div class="tab-stack"><div class="tab-content"><button class="tab-reset-pin-button">R</button><div class="tab-icon-stack"></div><div class="tab-label-container"><span class="tab-label">Check Point</span></div></div></div>';
        parent.append(tab); return tab;
      }
      const box = document.querySelector("#box"), outside = document.querySelector("#outside");
      row("check", box, ["pinned", "zen-pinned-changed"]);
      row("intune", box, ["pinned", "pending"]); row("ivanti", box, ["pinned"]);
      const nested = document.createElement("zen-folder"); box.append(nested);
      row("nested", nested, ["pinned"]);
      row("essential", box, ["zen-essential"]); row("empty", box, ["zen-empty-tab"]);
      row("glance", box, ["zen-glance-tab"]); row("ordinary-folder", box);
      row("outer", outside, ["pinned", "zen-pinned-changed"]);
      row("embedded", document.querySelector("#check .tab-content"), ["zen-glance-tab"]);
      window.readSlash = id => {
        const tab = document.getElementById(id);
        const label = tab.querySelector(":scope > .tab-stack > .tab-content > .tab-label-container");
        const button = tab.querySelector(":scope > .tab-stack > .tab-content > .tab-reset-pin-button");
        return { slash:getComputedStyle(label, "::before").content,
          native:getComputedStyle(button, "::after").content,
          nativeOpacity:getComputedStyle(button, "::after").opacity,
          resetVisible:getComputedStyle(button).display !== "none",
          height:tab.getBoundingClientRect().height };
      };
      window.resetClicks = 0;
      document.querySelector("#check .tab-reset-pin-button").onclick = () => window.resetClicks++;
    });
    // Reproduce both reported inconsistencies before loading the mod.
    assert.equal((await page.evaluate(() => readSlash("check"))).native, '""');
    assert.equal((await page.evaluate(() => readSlash("intune"))).resetVisible, false);
    await page.locator("#check > .tab-stack > .tab-content > .tab-reset-pin-button").hover();
    assert.equal((await page.evaluate(() => readSlash("check"))).nativeOpacity, "0");
    await page.evaluate(code => {
      window.__zenSafeClose = { config: {enabled:true, visuals:false, density:"roomy",
        hideClose:true, hideUnload:false, inactive:"unloaded", visualScope:"pinned", includeFolders:true},
        uninstall() {} };
      window.gBrowser = { tabs:[...document.querySelectorAll(".tabbrowser-tab")],
        selectedTab:document.getElementById("check") };
      (0, eval)(code);
    }, code);
    for (const density of ["roomy", "cosy", "compact"]) {
      const states = await page.evaluate(density => {
        window.__zenSafeClose.config.density = density;
        window.dispatchEvent(new Event("ZenSafeCloseConfigChanged"));
        const snapshots = [];
        for (const changed of [false,true]) for (const pending of [false,true])
          for (const selected of [false,true]) for (const busy of [false,true]) {
            const tab = document.getElementById("check");
            for (const [attr,on] of Object.entries({"zen-pinned-changed":changed,pending,visuallyselected:selected,busy}))
              on ? tab.setAttribute(attr,"true") : tab.removeAttribute(attr);
            snapshots.push(readSlash("check"));
          }
        return snapshots;
      }, density);
      for (const state of states) {
        assert.equal(state.slash, '"/"'); assert.equal(state.native, "none");
        assert.equal(state.height, 36, "slash must not own row height");
      }
      for (const id of ["intune", "ivanti", "nested", "ordinary-folder"]) {
        assert.equal((await page.evaluate(id => readSlash(id), id)).slash, '"/"');
      }
      for (const id of ["outer", "essential", "empty", "glance", "embedded"]) {
        assert.equal((await page.evaluate(id => readSlash(id), id)).slash, "none");
      }
    }
    // Hover does not erase the new marker, and the real reset hit target survives.
    await page.locator("#check > .tab-stack > .tab-content > .tab-reset-pin-button").click();
    assert.equal(await page.evaluate(() => resetClicks), 1);
    assert.equal((await page.evaluate(() => readSlash("check"))).slash, '"/"');
    await page.evaluate(() => {
      document.getElementById("folder").setAttribute("collapsed", "true");
      document.getElementById("check").setAttribute("folder-active", "true");
    });
    assert.equal((await page.evaluate(() => readSlash("check"))).slash, '"/"');
    await page.evaluate(() => document.documentElement.removeAttribute("zen-sidebar-expanded"));
    assert.equal((await page.evaluate(() => readSlash("check"))).slash, "none");
    await page.evaluate(() => {
      document.documentElement.setAttribute("zen-sidebar-expanded", "true");
      document.getElementById("outside").append(document.getElementById("ivanti"));
    });
    assert.equal((await page.evaluate(() => readSlash("ivanti"))).slash, "none");
    await page.evaluate(() => {
      window.__zenSafeClose.config.enabled = false;
      window.dispatchEvent(new Event("ZenSafeCloseConfigChanged"));
    });
    assert.equal((await page.evaluate(() => readSlash("check"))).slash, "none");
    assert.equal((await page.evaluate(() => readSlash("check"))).native, '""');
    await page.evaluate(() => window.__zenSafeClose.uninstall());
    assert.equal(await page.locator("#zen-safe-close-visuals").count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS native slash/hover reproduction; 48 state combinations; 3 densities; nested folders, exclusions, movement, reset click and cleanup");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
