import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { openEditor } from "./editor.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";

// Drives the real component through a fake ctx.ui.custom; no terminal needed.
async function drive(keys: string[], width = 80) {
  let component: any;
  const frames: string[][] = [];
  const ctx: any = {
    ui: {
      custom: (factory: Function) => new Promise((resolve) => {
        component = factory({ requestRender() {} }, { fg: (_c: string, t: string) => t, bold: (t: string) => t }, {}, resolve);
      }),
    },
  };
  const result = openEditor(ctx, DEFAULT_SETTINGS, () => ["preview"]);
  frames.push(component.render(width));
  for (const k of keys) { component.handleInput(k); frames.push(component.render(width)); }
  return { result, frames, component };
}

test("renders title, preview, lines and hints within width", async () => {
  const { frames, component } = await drive([], 40);
  const text = frames[0].join("\n");
  assert.match(text, /pi-usage-footer/);
  assert.match(text, /preview/);
  assert.match(text, /Line 1/);
  for (const l of frames[0]) assert.ok(visibleWidth(l) <= 40);
  component.handleInput("\x1b"); // cancel so the promise settles
});

test("esc cancels with undefined", async () => {
  const { result, component } = await drive([]);
  component.handleInput("\x1b");
  assert.equal(await result, undefined);
});

test("add a text widget via picker + input, then save returns it", async () => {
  const { result, component } = await drive([]);
  const send = (k: string) => component.handleInput(k);
  send("a"); send("\r");           // new line, open its (empty) widget view
  send("a");                       // picker
  for (let i = 0; i < 10; i++) send("\x1b[B"); // down to "text" (index 10)
  send("\r");                      // add
  send("t");                       // text input
  for (const ch of "hi") send(ch);
  send("\r");                      // confirm text
  send("\x1b");                    // back to lines
  send("s");                       // save
  const saved: any = await result;
  assert.deepEqual(saved.lines.at(-1), [{ type: "text", text: "hi" }]);
});

test("kitty/CSI-u encoded letter keys work (a adds a line, s saves)", async () => {
  const { result, component } = await drive([]);
  component.handleInput("\x1b[97u"); // a
  component.handleInput("\x1b[115u"); // s
  const saved: any = await result;
  assert.equal(saved.lines.length, DEFAULT_SETTINGS.lines.length + 1);
});

test("dispose settles the editor as cancelled", async () => {
  const { result, component } = await drive([]);
  component.dispose();
  assert.equal(await result, undefined);
});
