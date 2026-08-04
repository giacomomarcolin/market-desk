import type { Metadata } from "next";
import { MarketDesk } from "./market-desk";

export const metadata: Metadata = {
  title: "Market Desk",
  description: "A private economics job-market application tracker.",
};

export default function Home() {
  return <MarketDesk />;
}
