// Mercator Lab: the search box, for a city or typed coordinates. Shares the page's globals with app.js.
const q = $("q"), qList = $("q-results");
let qItems = [], qSel = 0;
function showResults() {
  const c = parseCoord(q.value);
  qItems = (c ? [{ c, label: fmtLL(c), where: "" }] : [])
    .concat(searchPlaces(PLACES, q.value, 8).map(([name, where, lat, lon]) => ({ c: [lon, lat], name, label: name, where })));
  qSel = 0; qList.innerHTML = "";
  qItems.forEach((it, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option"); li.setAttribute("aria-selected", i === qSel);
    li.innerHTML = '<span class="n"></span><span class="w"></span>';
    li.firstChild.textContent = it.label; li.lastChild.textContent = it.where;
    li.addEventListener("mousedown", e => { e.preventDefault(); choose(i); });
    qList.append(li);
  });
  qList.hidden = !qItems.length;
}
function choose(i) {
  const it = qItems[i]; if (!it) return;
  q.value = ""; qList.hidden = true; qItems = [];
  addMeasPoint(it.c, it.name || "");
}
q.addEventListener("input", showResults);
q.addEventListener("keydown", e => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    qSel = (qSel + (e.key === "ArrowDown" ? 1 : -1) + qItems.length) % Math.max(1, qItems.length);
    [...qList.children].forEach((li, k) => li.setAttribute("aria-selected", k === qSel));
  } else if (e.key === "Enter") { e.preventDefault(); choose(qSel); }
  else if (e.key === "Escape") { q.value = ""; qList.hidden = true; }
});
q.addEventListener("blur", () => { qList.hidden = true; });
