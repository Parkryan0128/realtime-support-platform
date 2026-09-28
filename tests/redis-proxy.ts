import { createServer, connect, type Socket } from "node:net";

export async function redisProxy(redisUrl: string) {
  const upstreamUrl = new URL(redisUrl);
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    const upstream = connect(
      Number(upstreamUrl.port || 6379),
      upstreamUrl.hostname,
    );
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on("close", () => {
        sockets.delete(socket);
        client.destroy();
        upstream.destroy();
      });
      socket.on("error", () => {
        client.destroy();
        upstream.destroy();
      });
    }
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing relay port");
  const url = new URL(redisUrl);
  url.hostname = "127.0.0.1";
  url.port = String(address.port);
  return {
    url: url.toString(),
    async restart() {
      if (!server.listening)
        await new Promise<void>((done, reject) => {
          server.once("error", reject);
          server.listen(address.port, "127.0.0.1", () => {
            server.off("error", reject);
            done();
          });
        });
    },
    async stop() {
      for (const socket of sockets) socket.destroy();
      if (server.listening)
        await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
