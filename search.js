// Mercator Lab: the From and To boxes, each searching cities or typed coordinates. Shares the page's globals with app.js.
function searchBox(input, list, onPick) {
  let items = [], sel = 0;
  function show() {
    const c = parseCoord(input.value);
    items = (c ? [{ c, label: fmtLL(c), where: "" }] : [])
      .concat(searchPlaces(PLACES, input.value, 8).map(([name, where, lat, lon]) => ({ c: [lon, lat], name, label: name, where })));
    sel = 0; list.innerHTML = "";
    items.forEach((it, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option"); li.setAttribute("aria-selected", i === sel);
      li.innerHTML = '<span class="n"></span><span class="w"></span>';
      li.firstChild.textContent = it.label; li.lastChild.textContent = it.where;
      li.addEventListener("mousedown", e => { e.preventDefault(); choose(i); });
      list.append(li);
    });
    list.hidden = !items.length;
  }
  function choose(i) {
    const it = items[i]; if (!it) return;
    list.hidden = true; items = [];
    onPick(it);
  }
  input.addEventListener("input", show);
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length);
      [...list.children].forEach((li, k) => li.setAttribute("aria-selected", k === sel));
    } else if (e.key === "Enter") { e.preventDefault(); choose(sel); }
    else if (e.key === "Escape") { input.value = ""; list.hidden = true; }
  });
  input.addEventListener("blur", () => { list.hidden = true; });
}
// From sets the start (replacing one already set); To finishes the route
searchBox($("from"), $("from-results"), it => { S.from = null; pickPoint(it.c, it.name); $("to").focus(); });
searchBox($("to"), $("to-results"), it => {
  if (!S.from) { $("to").value = ""; pickPoint(it.c, it.name); $("to").focus(); return; } // no start yet: this one is the start
  pickPoint(it.c, it.name);
});
