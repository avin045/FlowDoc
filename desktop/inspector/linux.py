#!/usr/bin/env python3
"""FlowDoc inspector for Linux (AT-SPI).

Long-running helper: one JSON request per line on stdin, one JSON answer per
line on stdout. Needs the AT-SPI GObject bindings (Debian/Ubuntu:
`sudo apt install python3-gi gir1.2-atspi-2.0`; Fedora: `python3-gobject at-spi2-core`).
"""
import json
import sys

try:
    import gi

    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi

    READY = True
except Exception as exc:  # bindings missing: report and answer with nulls
    READY = False
    REASON = str(exc)

SCREEN = None if not READY else Atspi.CoordType.SCREEN
WINDOW_ROLES = {"frame", "window", "dialog", "alert", "file chooser"}
TYPE_MAP = {
    "push button": "Button",
    "toggle button": "Button",
    "menu item": "MenuItem",
    "check menu item": "MenuItem",
    "radio menu item": "MenuItem",
    "check box": "CheckBox",
    "radio button": "RadioButton",
    "page tab": "TabItem",
    "text": "Edit",
    "entry": "Edit",
    "password text": "Edit",
    "combo box": "ComboBox",
    "list item": "ListItem",
    "table cell": "DataItem",
    "tree item": "TreeItem",
    "icon": "ListItem",
    "link": "Hyperlink",
    "document web": "Document",
    "document frame": "Document",
    "label": "Text",
    "image": "Image",
}


def safe(fn, default=None):
    try:
        return fn()
    except Exception:
        return default


def rect_of(acc):
    comp = safe(acc.get_component_iface)
    if not comp:
        return None
    r = safe(lambda: comp.get_extents(SCREEN))
    if not r or r.width <= 0 or r.height <= 0:
        return None
    return {"x": r.x, "y": r.y, "w": r.width, "h": r.height}


def describe(acc):
    if acc is None:
        return None
    role = safe(acc.get_role_name, "") or ""
    states = safe(acc.get_state_set)
    has = lambda s: bool(states and safe(lambda: states.contains(s), False))
    out = {
        "name": safe(acc.get_name, "") or "",
        "type": TYPE_MAP.get(role, role.title().replace(" ", "")),
        "role": role,
        "isPassword": role == "password text",
        "rect": rect_of(acc),
        "pid": safe(acc.get_process_id),
    }
    if role in ("check box", "toggle button", "check menu item"):
        out["toggle"] = "On" if has(Atspi.StateType.CHECKED) else "Off"
    if role != "password text":
        ti = safe(acc.get_text_iface)
        if ti:
            n = safe(ti.get_character_count, 0) or 0
            if 0 < n <= 2000:
                out["value"] = safe(lambda: ti.get_text(0, n), "")
    if not out["name"]:
        parent, i = safe(acc.get_parent), 0
        while parent is not None and i < 4:
            if safe(parent.get_role_name, "") in WINDOW_ROLES:
                break
            pname = safe(parent.get_name, "")
            if pname:
                out["parentName"] = pname
                out["parentType"] = TYPE_MAP.get(safe(parent.get_role_name, ""), "")
                out["parentRect"] = rect_of(parent)
                break
            parent, i = safe(parent.get_parent), i + 1
    node, depth = acc, 0
    while node is not None and depth < 60:
        if safe(node.get_role_name, "") in WINDOW_ROLES:
            out["window"] = safe(node.get_name, "")
            break
        node, depth = safe(node.get_parent), depth + 1
    app = safe(acc.get_application)
    out["app"] = safe(app.get_name, "") if app else ""
    return out


def windows():
    desktop = Atspi.get_desktop(0)
    for i in range(safe(desktop.get_child_count, 0) or 0):
        app = safe(lambda: desktop.get_child_at_index(i))
        if app is None:
            continue
        for j in range(safe(app.get_child_count, 0) or 0):
            win = safe(lambda: app.get_child_at_index(j))
            if win is not None:
                yield win


def at_point(x, y):
    candidates = []
    for win in windows():
        states = safe(win.get_state_set)
        if not states or not safe(lambda: states.contains(Atspi.StateType.SHOWING), False):
            continue
        comp = safe(win.get_component_iface)
        if comp and safe(lambda: comp.contains(x, y, SCREEN), False):
            active = safe(lambda: states.contains(Atspi.StateType.ACTIVE), False)
            candidates.append((0 if active else 1, win))
    if not candidates:
        return None
    candidates.sort(key=lambda c: c[0])
    node = candidates[0][1]
    for _ in range(80):  # descend to the deepest element under the point
        comp = safe(node.get_component_iface)
        child = safe(lambda: comp.get_accessible_at_point(x, y, SCREEN)) if comp else None
        if child is None or child == node:
            break
        node = child
    return node


def focused():
    for win in windows():
        states = safe(win.get_state_set)
        if not states or not safe(lambda: states.contains(Atspi.StateType.ACTIVE), False):
            continue
        queue, seen = [win], 0
        while queue and seen < 4000:
            node = queue.pop(0)
            seen += 1
            st = safe(node.get_state_set)
            if st and safe(lambda: st.contains(Atspi.StateType.FOCUSED), False):
                return node
            for k in range(min(safe(node.get_child_count, 0) or 0, 400)):
                child = safe(lambda: node.get_child_at_index(k))
                if child is not None:
                    queue.append(child)
    return None


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        res = {}
        try:
            req = json.loads(line)
            res["id"] = req.get("id")
            op = req.get("op")
            if not READY:
                res["error"] = "atspi-unavailable: " + REASON
            elif op == "point":
                res["el"] = describe(at_point(int(req["x"]), int(req["y"])))
            elif op == "focus":
                res["el"] = describe(focused())
            elif op == "ping":
                res["ok"] = True
            else:
                res["error"] = "unknown op %s" % op
        except Exception as exc:
            res["error"] = str(exc)
        sys.stdout.write(json.dumps(res) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
