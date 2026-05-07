import { z } from "zod";

export const SymbolStat = z.object({
  product_id: z.string(),
  trades: z.number(),
  volume_usd: z.number(),
  avg_trade_usd: z.number().optional(),
  low: z.number().optional(),
  high: z.number().optional(),
  latest_trade: z.string(),
});
export type SymbolStat = z.infer<typeof SymbolStat>;

export const StatsResponse = z.object({
  window: z.string(),
  by_symbol: z.array(SymbolStat),
});
export type StatsResponse = z.infer<typeof StatsResponse>;

export const PriceResponse = z.object({
  symbol: z.string(),
  price: z.number().nullable(),
  price_at: z.string().nullable(),
  price_1h_ago: z.number().nullable(),
  pct_change_1h: z.number().nullable(),
});
export type PriceResponse = z.infer<typeof PriceResponse>;

export const Candle = z.object({
  minute: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume_base: z.number().optional(),
  volume_usd: z.number(),
  trade_count: z.number().optional(),
});
export type Candle = z.infer<typeof Candle>;

export const CandlesResponse = z.object({
  symbol: z.string(),
  minutes: z.number(),
  candles: z.array(Candle),
});

export const ZScoreAnomaly = z.object({
  minute: z.string(),
  product_id: z.string(),
  volume_usd: z.number(),
  mean_60m: z.number().nullable(),
  stddev_60m: z.number().nullable(),
  z_score: z.number().nullable(),
  method: z.string(),
});
export const ZScoreAnomaliesResponse = z.object({
  layer: z.string(),
  anomalies: z.array(ZScoreAnomaly),
});

export const ForecastPoint = z.object({
  minute: z.string(),
  volume_usd: z.number(),
  lower_bound: z.number().nullable(),
  upper_bound: z.number().nullable(),
  is_anomaly: z.boolean(),
  anomaly_probability: z.number().nullable(),
});
export const ForecastResponse = z.object({
  symbol: z.string(),
  window_hours: z.number(),
  points: z.array(ForecastPoint),
});

export const Whale = z.object({
  trade_time: z.string(),
  product_id: z.string(),
  side: z.string(),
  size: z.number(),
  price: z.number(),
  volume_usd: z.number(),
  p99_volume_usd: z.number().nullable(),
  x_above_p99: z.number().nullable(),
});
export const WhalesResponse = z.object({
  whales: z.array(Whale),
});

export const HealthResponse = z.object({
  status: z.string(),
  error: z.string().optional(),
});

export const SYMBOL_REGEX = /^[A-Z]{2,6}-[A-Z]{3,5}$/;
export const SymbolParam = z.string().regex(SYMBOL_REGEX, "Invalid symbol format");
