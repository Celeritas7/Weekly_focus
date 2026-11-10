/* Shared goal picker and writing editor. Persistence belongs to the app host. */
(function () {
  "use strict";
  var serial = 0;
  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function button(text, cls, action) {
    var el = node("button", cls, text); el.type = "button";
    el.addEventListener("click", action); return el;
  }
  function shell(kind, options) {
    var dialog = node("dialog", "wf-detail-dialog wf-" + kind), titleId = "wf-detail-title-" + (++serial);
    var head = node("header", "wf-detail-head"), names = node("div"), title = node("h2", "", options.title);
    title.id = titleId; title.tabIndex = -1; title.setAttribute("autofocus", ""); dialog.setAttribute("aria-labelledby", titleId);
    names.appendChild(title);
    if (options.subtitle) names.appendChild(node("p", "wf-detail-subtitle", options.subtitle));
    head.appendChild(names);
    var close = button("×", "wf-detail-close", function () { dialog.close(); });
    close.setAttribute("aria-label", kind === "writer" ? "Cancel editing" : "Close goal picker");
    head.appendChild(close); dialog.appendChild(head);
    var body = node("div", "wf-detail-body"), foot = node("footer", "wf-detail-foot");
    dialog.appendChild(body); dialog.appendChild(foot); document.body.appendChild(dialog);
    // Keep the footer inside the visible viewport when a mobile keyboard opens.
    var viewport = window.visualViewport;
    function fit() {
      dialog.style.setProperty("--wf-vv-height", (viewport ? viewport.height : window.innerHeight) + "px");
      dialog.style.setProperty("--wf-vv-top", (viewport ? viewport.offsetTop : 0) + "px");
    }
    fit();
    if (viewport) { viewport.addEventListener("resize", fit); viewport.addEventListener("scroll", fit); }
    else window.addEventListener("resize", fit);
    // Background card and Sphere keyboard shortcuts must not consume dialog keys.
    dialog.addEventListener("keydown", function (event) { event.stopPropagation(); });
    dialog.addEventListener("close", function () {
      if (viewport) { viewport.removeEventListener("resize", fit); viewport.removeEventListener("scroll", fit); }
      else window.removeEventListener("resize", fit);
      dialog.remove();
      if (options.onClose) options.onClose();
      var target = options.returnFocus ? options.returnFocus() : options.source;
      if (target && target.isConnected) target.focus({ preventScroll: true });
    }, { once: true });
    return { dialog: dialog, title: title, body: body, foot: foot };
  }
  function openGoals(options) {
    var ui = shell("goals", { title: "Choose goals", subtitle: options.name, source: options.source, returnFocus: options.returnFocus, onClose: options.onClose });
    var searchLabel = node("label", "wf-goal-search", "Find a goal");
    var search = node("input"); search.type = "search"; search.placeholder = "Search your goals"; search.autocomplete = "off";
    searchLabel.appendChild(search); ui.body.appendChild(searchLabel);
    var count = node("p", "wf-goal-count"); count.setAttribute("aria-live", "polite"); ui.body.appendChild(count);
    var list = node("div", "wf-goal-list"); list.setAttribute("role", "group"); list.setAttribute("aria-label", "Available goals"); ui.body.appendChild(list);
    var error = node("p", "wf-detail-error"); error.setAttribute("role", "alert"); error.hidden = true; ui.body.appendChild(error);
    function attempt(action) {
      try { error.hidden = true; action(); return true; }
      catch (err) { error.textContent = err.message || "Could not update this goal. Please try again."; error.hidden = false; return false; }
    }
    function render(focusId, focusLead) {
      var all = options.goals(), query = search.value.trim().toLowerCase();
      var shown = all.filter(function (g) { return !query || g.name.toLowerCase().indexOf(query) >= 0; });
      count.textContent = all.filter(function (g) { return g.selected; }).length + " selected";
      list.replaceChildren();
      shown.forEach(function (goal) {
        var row = node("div", "wf-goal-choice" + (goal.selected ? " is-selected" : ""));
        var label = node("label", "wf-goal-option"), check = node("input"), text = node("span", "", goal.name);
        check.type = "checkbox"; check.checked = goal.selected; check.dataset.goal = goal.id;
        check.addEventListener("change", function () {
          attempt(function () { options.toggle(goal.id, check.checked); }); render(goal.id, false);
        });
        label.appendChild(check); label.appendChild(text); row.appendChild(label);
        if (goal.selected && options.toggleLead) {
          var lead = button(goal.lead ? "★ Lead app" : "Make lead", "wf-goal-lead", function () {
            attempt(function () { options.toggleLead(goal.id, !goal.lead); }); render(goal.id, true);
          });
          lead.dataset.lead = goal.id; lead.setAttribute("aria-pressed", String(!!goal.lead));
          lead.setAttribute("aria-label", (goal.lead ? "Clear lead for " : "Make this app the lead for ") + goal.name);
          row.appendChild(lead);
        }
        list.appendChild(row);
      });
      if (!shown.length) list.appendChild(node("p", "wf-goal-empty", all.length ? "No matching goals. You can create one below." : "No goals yet. Create your first one below."));
      if (focusId) {
        var candidates = list.querySelectorAll(focusLead ? "[data-lead]" : "[data-goal]");
        Array.prototype.forEach.call(candidates, function (el) { if ((focusLead ? el.dataset.lead : el.dataset.goal) === focusId) el.focus({ preventScroll: true }); });
      }
    }
    search.addEventListener("input", function () { render(); });
    var form = node("form", "wf-goal-create"), createLabel = node("label", "", "Create a goal"), name = node("input");
    name.type = "text"; name.maxLength = 80; name.placeholder = "Name your new goal"; name.required = true; name.autocomplete = "off";
    createLabel.appendChild(name); form.appendChild(createLabel);
    var create = node("button", "wf-detail-primary", "Create & link"); create.type = "submit"; form.appendChild(create);
    form.addEventListener("submit", function (event) {
      event.preventDefault(); var value = name.value.trim();
      if (!value) { name.focus(); return; }
      var id;
      if (attempt(function () { id = options.create(value); if (!id) throw new Error("Enter a goal name."); })) {
        name.value = ""; search.value = ""; render(id, false);
        count.textContent += " · Goal linked";
      }
    });
    ui.body.appendChild(form);
    ui.foot.appendChild(node("span", "wf-detail-hint", "Select all the goals this app serves."));
    ui.foot.appendChild(button("Done", "wf-detail-primary", function () { ui.dialog.close(); }));
    ui.dialog.addEventListener("click", function (event) {
      if (event.target !== ui.dialog) return;
      var r = ui.dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) ui.dialog.close();
    });
    render(); ui.dialog.showModal(); ui.title.focus({ preventScroll: true });
  }
  function openWriter(options) {
    var ui = shell("writer", options), input = node("textarea", "wf-writer-input"), error = node("p", "wf-detail-error");
    input.value = options.value || ""; input.placeholder = options.placeholder || "Write here…";
    input.setAttribute("aria-label", options.title); input.spellcheck = true;
    error.setAttribute("role", "alert"); error.hidden = true;
    ui.body.appendChild(input); ui.body.appendChild(error);
    function save() {
      try { options.save(input.value); ui.dialog.close(); }
      catch (err) { error.textContent = err.message || "Could not save. Your text is still here."; error.hidden = false; }
    }
    ui.foot.appendChild(node("span", "wf-detail-hint", "Enter adds a new line. Ctrl/⌘ + Enter saves."));
    var actions = node("div", "wf-writer-actions");
    actions.appendChild(button("Cancel", "wf-detail-secondary", function () { ui.dialog.close(); }));
    actions.appendChild(button("Save", "wf-detail-primary", save)); ui.foot.appendChild(actions);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); save(); }
    });
    ui.dialog.showModal(); input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }
  window.WFDetailUI = { openGoals: openGoals, openWriter: openWriter };
})();
