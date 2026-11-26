import {
  Controls,
  Description,
  DocsContext,
  Primary,
  Title,
} from "@storybook/addon-docs/blocks";
import { useContext } from "react";

export default function ReferencePage() {
  const examples = useContext(DocsContext)
    .componentStories()
    .slice(1)
    .filter((story) => story.tags.includes("autodocs"));
  return (
    <>
      <Title />
      <Primary />
      <Description />
      <Controls />
      {examples.length > 0 && (
        <nav aria-label="More examples" className="sbdocs-content">
          <h2>More examples</h2>
          <ul>
            {examples.map(({ id, name }) => (
              <li key={id}>
                <a href={`./?path=/story/${id}`} target="_top">
                  {name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </>
  );
}
