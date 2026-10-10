import { Fragment } from "react";
import type { CSSProperties, ReactNode } from "react";

import { styles } from "./styles";

/** Splits a line of copy into masked words for the text reveals in landing.css. `from` continues
 *  the stagger index across several calls (the hero headline's two sentences). */
export function Words({ text, from = 0 }: { text: string; from?: number }) {
  return text.split(" ").map((word, i) => (
    <Fragment key={i}>
      {i > 0 ? " " : null}
      <span className={styles.word}>
        <span className={styles.wordInner} style={{ "--i": from + i } as CSSProperties}>
          {word}
        </span>
      </span>
    </Fragment>
  ));
}

/** A section headline whose words rise into place as it scrolls in (line by line, since words on
 *  one line share a position). Without scroll timelines it plays once on arrival. */
export function RevealHeading({
  id,
  text,
  className = "",
  as: Tag = "h2",
}: {
  id?: string;
  text: string;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <Tag id={id} className={`${styles.reveal} ${className}`} data-play="" data-scrub="">
      <Words text={text} />
    </Tag>
  );
}

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-8 ${className}`}>{children}</div>;
}

export function Perforation({ className = "" }: { className?: string }) {
  return (
    <Container className={className}>
      <div className={styles.perforation} role="presentation" />
    </Container>
  );
}
