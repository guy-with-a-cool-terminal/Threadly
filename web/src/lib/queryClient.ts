import { QueryClient } from "@tanstack/react-query";

// staleTime > 0 means a remounted component (e.g. the same page after the
// auth-refresh unmount bug, or just normal navigation) shows cached data
// immediately instead of a blank loading state while it refetches in the
// background - the caching behavior this was actually set up for.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});
