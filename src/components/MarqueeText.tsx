import { useEffect, useRef, useState } from "react";

// 이름이 길어서 잘렸을 때, 마우스를 올리면 좌우로 슬라이드되며 전체 텍스트를 보여준다.
export function MarqueeText({
  text,
  className,
  style,
}: {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;
    const diff = textEl.scrollWidth - container.clientWidth;
    setOverflowPx(diff > 2 ? diff : 0);
  }, [text]);

  return (
    <span
      ref={containerRef}
      className={`marquee-text${className ? ` ${className}` : ""}`}
      title={text}
      style={{ minWidth: 0, maxWidth: "100%", ...style }}
    >
      <span
        ref={textRef}
        style={{
          transitionProperty: "transform",
          transitionDuration: `${Math.min(3, Math.max(0.6, overflowPx / 40))}s`,
          transitionTimingFunction: "ease",
          ["--marquee-distance" as string]: `-${overflowPx}px`,
        }}
      >
        {text}
      </span>
    </span>
  );
}
