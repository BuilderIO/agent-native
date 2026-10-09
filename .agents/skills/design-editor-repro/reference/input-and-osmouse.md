# Input in the Design editor

Use Playwright page input for ordinary clicks, keyboard shortcuts, drags, and
text entry. It is repeatable and keeps the reproduction attached to the app
page.

Use the OS mouse helper only when the defect depends on operating-system input
or browser focus. The helper moves the machine's physical cursor, so hold the
lock from harness/lock.mjs around the whole interaction and release it in a
finally block.

After each gesture, check the editor's visible state and persisted files. For a
drag, record the starting layer, pointer location, destination, and resulting
parent or position. For keyboard input, record the active editor and selected
layer before sending the key.

Avoid fixed sleeps when the app exposes an event, state transition, or visible
condition that can be polled. If settling time is unavoidable, keep it local to
the unstable boundary and explain what state the wait allows to settle.
