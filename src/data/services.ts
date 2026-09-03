import { queryOptions } from "@tanstack/react-query";
import { getAdapter } from "./index";

export const overviewQueryOptions = queryOptions({
  queryKey: ["overview"],
  queryFn: ({ signal }) => getAdapter().getOverview(signal),
  staleTime: 30_000,
});

export const casesQueryOptions = queryOptions({
  queryKey: ["demo-cases"],
  queryFn: () => getAdapter().getCases(),
  staleTime: Infinity,
});
