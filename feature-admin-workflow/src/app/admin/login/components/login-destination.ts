type LoginIdentity = {
  role: string;
  driverId?: string;
};

export function resolveLoginDestination(
  identity: LoginIdentity,
  requestedPath: string
) {
  if (identity.role === "driver" && identity.driverId) {
    return "/driver/tasks";
  }

  return requestedPath;
}
