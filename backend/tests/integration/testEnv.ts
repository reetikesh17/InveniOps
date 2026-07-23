// Integration tests run on the host (via `npm run test:integration`), not
// inside a container, so they must hit the published ports rather than the
// docker-compose service names ("postgres", "mongo") used by containers.
export const TEST_DATABASE_URL: string =
  process.env.TEST_DATABASE_URL ?? "postgresql://ims_user:ims_password@localhost:5432/ims";

export const TEST_MONGODB_URI: string = process.env.TEST_MONGODB_URI ?? "mongodb://localhost:27017/ims";
