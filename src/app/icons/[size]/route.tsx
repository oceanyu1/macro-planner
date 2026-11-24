import { ImageResponse } from "next/og";

export function generateStaticParams() {
  return [{ size: "192" }, { size: "512" }];
}

export async function GET(_req: Request, ctx: RouteContext<"/icons/[size]">) {
  const { size } = await ctx.params;
  const px = size === "512" ? 512 : 192;
  return new ImageResponse(<Mark px={px} />, { width: px, height: px });
}

/** App mark: a white "M" on blue. */
function Mark({ px }: { px: number }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#2563eb",
        color: "white",
        fontSize: px * 0.5,
        fontWeight: 800,
        letterSpacing: -px * 0.02,
      }}
    >
      M
    </div>
  );
}
