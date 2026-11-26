import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findPartGeometryClasses,
  isInScope,
} from "./guard-no-part-geometry-classes.ts";

const FILE = "templates/design/app/components/Example.tsx";

function flagged(source: string, added: number[] | null = null) {
  return findPartGeometryClasses(
    FILE,
    source,
    added === null ? null : new Set(added),
  ).map((finding) => `${finding.line}:${finding.tag}:${finding.className}`);
}

function onButton(className: string) {
  return flagged(`const a = <Button className="${className}" />;`);
}

void describe("part geometry class detection", () => {
  void it("flags height, size, padding, radius, type and width classes on a part", () => {
    const forbidden = [
      "h-6",
      "h-[22px]",
      "min-h-8",
      "max-h-[10rem]",
      "size-4",
      "p-2",
      "px-3",
      "py-1",
      "ps-2",
      "pe-2",
      "pt-1",
      "pb-1",
      "rounded",
      "rounded-md",
      "rounded-[3px]",
      "text-xs",
      "text-sm",
      "text-base",
      "text-lg",
      "text-xl",
      "text-2xl",
      "text-sm/6",
      "text-[11px]",
      "text-[0.75rem]",
      "font-thin",
      "font-medium",
      "font-semibold",
      "font-black",
      "font-[450]",
      "min-w-[12rem]",
      "w-[240px]",
      "max-w-[20rem]",
    ];
    for (const className of forbidden) {
      assert.deepEqual(
        onButton(className),
        [`1:Button:${className}`],
        `${className} should be flagged`,
      );
    }
  });

  void it("flags through variant and important prefixes", () => {
    assert.deepEqual(onButton("hover:h-6"), ["1:Button:hover:h-6"]);
    assert.deepEqual(onButton("md:px-4"), ["1:Button:md:px-4"]);
    assert.deepEqual(onButton("!text-[11px]"), ["1:Button:!text-[11px]"]);
    assert.deepEqual(onButton("md:hover:!h-9"), ["1:Button:md:hover:!h-9"]);
  });

  void it("passes layout classes", () => {
    const allowed = [
      "w-full",
      "w-auto",
      "w-fit",
      "min-w-0",
      "max-w-full",
      "flex-1",
      "flex-none",
      "shrink-0",
      "grow",
      "justify-between",
      "items-center",
      "self-start",
      "gap-2",
      "m-2",
      "mx-auto",
      "mt-1",
      "-ms-1",
      "-me-2",
      "truncate",
      "whitespace-nowrap",
      "text-left",
      "text-center",
      "text-right",
      "text-muted-foreground",
      "text-foreground",
      "text-[var(--accent)]",
      "bg-accent",
      "border-border",
      "opacity-50",
      "cursor-pointer",
      "z-10",
      "absolute",
      "left-2",
      "hidden",
      "sr-only",
      "pointer-events-none",
      "h-full",
      "h-auto",
    ];
    for (const className of allowed) {
      assert.deepEqual(onButton(className), [], `${className} should pass`);
    }
  });

  void it("ignores variants that target descendants", () => {
    assert.deepEqual(onButton("[&_svg]:size-3 *:p-2"), []);
  });

  void it("reports each forbidden class in a mixed class string", () => {
    assert.deepEqual(onButton("w-full h-6 gap-1 px-2"), [
      "1:Button:h-6",
      "1:Button:px-2",
    ]);
  });

  void it("does not flag non-part elements", () => {
    assert.deepEqual(flagged('const a = <div className="h-6 px-2" />;'), []);
    assert.deepEqual(
      flagged('const a = <Skeleton className="h-6 w-[120px]" />;'),
      [],
    );
    assert.deepEqual(flagged('const a = <Avatar className="size-6" />;'), []);
    assert.deepEqual(flagged('const a = <MyButton className="h-6" />;'), []);
  });

  void it("flags every part tag, on opening and self-closing elements", () => {
    assert.deepEqual(
      flagged(
        [
          'const a = <SelectTrigger className="h-6">x</SelectTrigger>;',
          'const b = <SelectItem className="!text-[11px]" />;',
          'const c = <SelectContent className="min-w-[12rem]" />;',
        ].join("\n"),
      ),
      [
        "1:SelectTrigger:h-6",
        "2:SelectItem:!text-[11px]",
        "3:SelectContent:min-w-[12rem]",
      ],
    );
  });

  void it("flags string literals inside cn(), clsx() and conditionals", () => {
    const source = [
      "const a = (",
      "  <Button",
      '    className={cn("a", cond && "h-6")}',
      "  />",
      ");",
      "const b = <Button className={clsx(cond ? 'px-2' : 'flex-1')} />;",
      "const c = <Button className={`flex-1 ${cond ? 'text-xs' : ''}`} />;",
      'const d = <Button className={cn({ "rounded-md": cond })} />;',
    ].join("\n");
    assert.deepEqual(flagged(source), [
      "3:Button:h-6",
      "6:Button:px-2",
      "7:Button:text-xs",
      "8:Button:rounded-md",
    ]);
  });

  void it("uses the line of the class, not the element, in a multi-line string", () => {
    const source = [
      "const a = (",
      "  <Button",
      "    className={`flex-1",
      "      h-6`}",
      "  />",
      ");",
    ].join("\n");
    assert.deepEqual(flagged(source), ["4:Button:h-6"]);
  });

  void it("only reports classes on lines this branch added", () => {
    const source = [
      'const a = <Button className="h-6" />;',
      'const b = <Button className="h-8" />;',
    ].join("\n");
    assert.deepEqual(flagged(source, [2]), ["2:Button:h-8"]);
    assert.deepEqual(flagged(source, []), []);
  });

  void it("does not report a class on an unchanged line of an edited element", () => {
    const source = [
      "const a = (",
      "  <Button",
      '    className={cn("h-6", cond && "px-2")}',
      '    variant="outline"',
      "  />",
      ");",
    ].join("\n");
    assert.deepEqual(flagged(source, [4]), []);
    assert.deepEqual(flagged(source, [3]), ["3:Button:h-6", "3:Button:px-2"]);
  });

  void it("accepts a reasoned opt-out on the line or the line above, and rejects a bare one", () => {
    const sameLine =
      'const a = <Button className="h-6" />; // guard:allow-part-geometry matches the legacy toolbar row';
    const lineAbove = [
      "// guard:allow-part-geometry matches the legacy toolbar row",
      'const a = <Button className="h-6" />;',
    ].join("\n");
    const jsxComment = [
      "const a = (",
      "  <div>",
      "    {/* guard:allow-part-geometry matches the legacy toolbar row */}",
      '    <Button className="h-6" />',
      "  </div>",
      ");",
    ].join("\n");
    const bare = [
      "// guard:allow-part-geometry ok",
      'const a = <Button className="h-6" />;',
    ].join("\n");
    assert.deepEqual(flagged(sameLine), []);
    assert.deepEqual(flagged(lineAbove), []);
    assert.deepEqual(flagged(jsxComment), []);
    assert.deepEqual(flagged(bare), ["2:Button:h-6"]);
  });

  void it("judges an imported tag by the part it imports", () => {
    const aliased = [
      'import { Button as ToolkitButton } from "@agent-native/toolkit/ui/button";',
      'const a = <ToolkitButton className="h-7" />;',
    ].join("\n");
    const fromUi = [
      'import { Button } from "../ui/button.js";',
      'const a = <Button className="h-7" />;',
    ].join("\n");
    const wrapper = [
      'import { Button } from "./TeamPrimitives.js";',
      'const a = <Button className="h-7" />;',
    ].join("\n");
    const primitive = [
      'import { PrimitiveButton as Button } from "../PrimitiveButton.js";',
      'const a = <Button className="h-7" />;',
    ].join("\n");
    assert.deepEqual(flagged(aliased), ["2:ToolkitButton:h-7"]);
    assert.deepEqual(flagged(fromUi), ["2:Button:h-7"]);
    assert.deepEqual(flagged(wrapper), []);
    assert.deepEqual(flagged(primitive), []);
  });

  void it("scopes to migrated .tsx outside tests, stories and the design system", () => {
    assert.equal(isInScope("templates/design/app/components/Panel.tsx"), true);
    assert.equal(isInScope("packages/toolkit/src/app/sharing/Share.tsx"), true);
    assert.equal(isInScope("templates/mail/app/components/Panel.tsx"), false);
    assert.equal(isInScope("packages/dispatch/src/components/Pin.tsx"), false);
    assert.equal(isInScope("templates/design/app/components/Panel.ts"), false);
    assert.equal(
      isInScope("templates/design/app/components/Panel.test.tsx"),
      false,
    );
    assert.equal(isInScope("packages/toolkit/src/app/Share.spec.tsx"), false);
    assert.equal(
      isInScope("packages/toolkit/src/stories/Button.stories.tsx"),
      false,
    );
    assert.equal(isInScope("packages/toolkit/src/stories/Gallery.tsx"), false);
    assert.equal(
      isInScope("packages/toolkit/src/ui/base-ui/select.tsx"),
      false,
    );
    assert.equal(
      isInScope("packages/design-system/src/parts/button.tsx"),
      false,
    );
    assert.equal(isInScope("packages/toolkit/dist/index.tsx"), false);
    assert.equal(isInScope("templates/design/node_modules/x/y.tsx"), false);
  });
});
