// Stands in for the PAGE_ROOM binding: records each call to a room and
// answers 204, so tests can check what the site asked of which room.
export function fakeRoomBinding() {
  const calls = [];
  return {
    calls,
    idFromName: name => ({ name }),
    get: id => ({
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({
          page: id.name, url: request.url, method: request.method,
          headers: Object.fromEntries(request.headers),
          body: await request.text(),
        });
        return new Response(null, { status: 204 });
      },
    }),
  };
}
