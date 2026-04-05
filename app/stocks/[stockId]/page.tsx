import { StockClient } from "@/app/components/stock-client";

export default async function StockPage({
  params,
}: {
  params: Promise<{ stockId: string }>;
}) {
  const { stockId } = await params;
  return <StockClient stockId={stockId} />;
}
