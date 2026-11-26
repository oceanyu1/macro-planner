/**
 * Today's read: one AI/ML/programming article a day on the dashboard.
 *
 * PLACEHOLDER. Where articles come from is still to be decided (a list of
 * sources, Claude picking one each morning, or a curated reading list), and so
 * is whether reading gets tracked. Until then this returns one fixed, real
 * article, flagged `placeholder: true` so the UI says so. Swap the body of
 * `getTodaysRead` for the real source; the card only depends on `DailyRead`.
 */
export type DailyRead = {
  title: string;
  author: string;
  source: string;
  url: string;
  topic: string;
  minutes: number;
  summary: string;
  /** Two or three things to look out for while reading. */
  lookFor: string[];
  placeholder: boolean;
};

const PLACEHOLDER_READ: DailyRead = {
  title: "The Illustrated Transformer",
  author: "Jay Alammar",
  source: "jalammar.github.io",
  url: "https://jalammar.github.io/illustrated-transformer/",
  topic: "Machine learning",
  minutes: 20,
  summary:
    "A visual walk through the model from “Attention Is All You Need”: how self-attention lets every word look at every other word, what queries, keys and values are, why there are several attention heads, and how the encoder and decoder stacks fit together.",
  lookFor: [
    "How attention scores come from queries and keys",
    "What multi-head attention adds over a single head",
    "How positional encoding gives the model word order",
  ],
  placeholder: true,
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `date` is the real source's input
export async function getTodaysRead(date: string): Promise<DailyRead> {
  return PLACEHOLDER_READ;
}
