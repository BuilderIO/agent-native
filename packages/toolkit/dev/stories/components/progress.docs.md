Progress reports how much work a task has completed. Use a determinate value when the total is known, or an indeterminate bar while waiting for a meaningful estimate.

Pass `value={null}` for indeterminate work. Set `duration` to adjust the animation. With reduced motion, a stationary striped track shows that the task is still running. Give each progress indicator a task-specific name, particularly when several files are uploading.

```tsx
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@agent-native/toolkit/ui/base-ui/progress";

<Progress value={40}>
  <ProgressLabel>Uploading recording</ProgressLabel>
  <ProgressValue />
</Progress>;
```

Set `min` and `max` for a custom range. A frame counter running from −24 to 72 is 25% complete at frame zero. [Frame progress example](?path=/story/components-progress--signed-range)

[Base UI · Progress](https://base-ui.com/react/components/progress)
