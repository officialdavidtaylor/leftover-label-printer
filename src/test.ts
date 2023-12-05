Deno.serve((req: Request) => {
  console.log(req);
  return new Response("Hello, world!");
});
