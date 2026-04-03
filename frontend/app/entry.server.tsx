import { PassThrough } from 'node:stream';

import { createReadableStreamFromReadable } from '@react-router/node';
import type { AppLoadContext, EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';
import { renderToPipeableStream } from 'react-dom/server';

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: AppLoadContext
) {
  void loadContext;

  return new Promise<Response>((resolve, reject) => {
    const { pipe } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        onAllReady() {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set('content-type', 'text/html; charset=utf-8');
          pipe(body);

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
        },
        onShellError(error: unknown) {
          reject(error instanceof Error ? error : new Error('Failed to render the document shell.'));
        },
        onError(error: unknown) {
          console.error(error);
        },
      }
    );
  });
}
