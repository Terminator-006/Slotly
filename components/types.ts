import type { apiBooking, apiBusiness, apiService, apiUser } from "@/lib/serialize";

export type ApiBusiness = ReturnType<typeof apiBusiness>;
export type ApiService = ReturnType<typeof apiService>;
export type ApiBooking = ReturnType<typeof apiBooking>;
export type ApiUser = ReturnType<typeof apiUser>;
export type Window = { weekday: number; startMin: number; endMin: number };
