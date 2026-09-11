export type CanvasAnnotationTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export interface SendCanvasAnnotationInput {
  message: string;
  submit: boolean;
  openSidebar: boolean;
}

export type SendCanvasAnnotation = (
  input: SendCanvasAnnotationInput,
) => boolean | Promise<boolean>;
