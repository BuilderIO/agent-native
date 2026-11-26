import {
  type DataListOwnProps,
  dataListProps,
} from "@agent-native/design-system";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { splitProps } from "./props.js";

export interface DataListProps
  extends useRender.ComponentProps<"dl">, DataListOwnProps {}

/**
 * Label and value pairs, such as a record's details, as Radix Themes'
 * DataList: a description list of items, each a label and a value.
 *
 * @import import { DataList, DataListItem, DataListLabel, DataListValue } from "@agent-native/toolkit/ui/base-ui/data-list";
 */
function DataList(props: DataListProps) {
  const [attributes, { render, ...rest }] = splitProps(dataListProps, props);
  return useRender({
    defaultTagName: "dl",
    render,
    props: mergeProps<"dl">({ className: "data-list", ...attributes }, rest),
  });
}

export type DataListItemProps = useRender.ComponentProps<"div">;

/**
 * One label and value pair in a DataList.
 *
 * @import import { DataListItem } from "@agent-native/toolkit/ui/base-ui/data-list";
 */
function DataListItem({ render, ...props }: DataListItemProps) {
  return useRender({
    defaultTagName: "div",
    render,
    props: mergeProps<"div">({ className: "data-list-item" }, props),
  });
}

export type DataListLabelProps = useRender.ComponentProps<"dt">;

/**
 * The name of a pair, such as "Status" or "Owner".
 *
 * @import import { DataListLabel } from "@agent-native/toolkit/ui/base-ui/data-list";
 */
function DataListLabel({ render, ...props }: DataListLabelProps) {
  return useRender({
    defaultTagName: "dt",
    render,
    props: mergeProps<"dt">({ className: "data-list-label" }, props),
  });
}

export type DataListValueProps = useRender.ComponentProps<"dd">;

/**
 * The value a DataListLabel names.
 *
 * @import import { DataListValue } from "@agent-native/toolkit/ui/base-ui/data-list";
 */
function DataListValue({ render, ...props }: DataListValueProps) {
  return useRender({
    defaultTagName: "dd",
    render,
    props: mergeProps<"dd">({ className: "data-list-value" }, props),
  });
}

export { DataList, DataListItem, DataListLabel, DataListValue };
