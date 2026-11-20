export function FormCover({ url, height }: { url: string; height: number }) {
  return (
    <img
      src={url}
      alt=""
      className="forms-cover pointer-events-none absolute inset-x-0 top-0 w-full object-cover"
      style={{ height: `${height}vh` }}
    />
  );
}

/** Where the title starts on every respondent surface and the editor canvas. */
const CONTENT_TOP = 151;

/**
 * Sits on the cover's lower edge when there is a cover, otherwise near the top;
 * the spacer pushes the form down so a tall logo never covers the title.
 */
export function FormLogo({
  url,
  width,
  height,
  radius,
  coverHeight,
}: {
  url: string;
  width: number;
  height: number;
  radius: number;
  coverHeight: number | null;
}) {
  const top =
    coverHeight === null
      ? "24px"
      : `max(16px, calc(${coverHeight}vh - ${height / 2}px))`;
  return (
    <>
      <div
        aria-hidden
        style={{
          height: `max(0px, calc(${top} + ${height + 24 - CONTENT_TOP}px))`,
        }}
      />
      <div
        className="forms-logo-row pointer-events-none absolute inset-x-0 mx-auto w-full max-w-[var(--fs-page-width,700px)] px-4 min-[760px]:px-0"
        style={{ top }}
      >
        <img
          src={url}
          alt=""
          className="forms-logo object-cover"
          style={{ width, height, borderRadius: radius }}
        />
      </div>
    </>
  );
}
