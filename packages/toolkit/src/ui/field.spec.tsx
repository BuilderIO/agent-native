import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge.js";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "./field.js";
import { RadioGroup, RadioGroupItem } from "./radio-group.js";

describe("radio choice cards", () => {
  it("keeps the radio name, description, selection and optional restriction badge", () => {
    const html = renderToStaticMarkup(
      <FieldSet>
        <FieldLegend variant="label">Start from</FieldLegend>
        <RadioGroup defaultValue="fresh">
          <FieldLabel htmlFor="fresh">
            <Field>
              <RadioGroupItem
                id="fresh"
                value="fresh"
                aria-labelledby="fresh-title"
                aria-describedby="fresh-description"
              />
              <FieldContent>
                <FieldTitle id="fresh-title">Start fresh</FieldTitle>
                <FieldDescription id="fresh-description">
                  Shape the system in chat.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
          <FieldLabel htmlFor="licensed">
            <Field data-disabled="true">
              <RadioGroupItem
                id="licensed"
                value="licensed"
                disabled
                aria-labelledby="licensed-title"
                aria-describedby="licensed-description"
              />
              <Badge variant="secondary">License required</Badge>
              <FieldContent>
                <FieldTitle id="licensed-title">Licensed source</FieldTitle>
                <FieldDescription id="licensed-description">
                  Available with the source license.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
        </RadioGroup>
      </FieldSet>,
    );
    expect(html).toContain("<legend");
    expect(html).toContain('for="fresh"');
    expect(html).toContain('aria-labelledby="fresh-title"');
    expect(html).toContain('aria-describedby="fresh-description"');
    expect(html).toContain('data-state="checked"');
    expect(html).toContain("has-data-[state=checked]:border-primary");
    expect(html).toContain("License required");
    expect(html).toContain('disabled=""');
  });

  it("keeps error output optional and accessible", () => {
    expect(renderToStaticMarkup(<FieldError />)).toBe("");
    const html = renderToStaticMarkup(
      <FieldError errors={[{ message: "Choose a starting point" }]} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Choose a starting point");
  });
});
