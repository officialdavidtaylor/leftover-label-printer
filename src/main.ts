import { grayscale } from "https://cdn.skypack.dev/pdf-lib@^1.11.1?dts";
import { PDFDocument } from "https://cdn.skypack.dev/pdf-lib@^1.11.1?dts";

Deno.serve({ port: 4000, hostname: "0.0.0.0" }, async (req: Request) => {
  switch (req.method) {
    case "POST":
      return await PostHandler(req);
  }

  return new Response(null, {
    status: 404,
    statusText: "service endpoint does not exist",
  });
});

const PostHandler = async (request: Request): Promise<Response> => {
  // FIXME: integrate with Zod
  if (request.body) {
    const payload = await request.json();
    console.log("request payload", payload);

    const pdfName = await generatePdf(payload.labelText);

    // print the new PDF file
    const printStatus = await printLabel(pdfName, payload.labelText);

    console.log("printStatus: ", printStatus);

    console.log("queing file for removal...");
    // perform cleanup: remove the file after 10 seconds
    setTimeout(async () => {
      await Deno.remove(pdfName);
      console.log(`file: "${pdfName}" has been removed`);
    }, 10000);

    return new Response(
      `Printed ${payload.quantity} label${
        payload.quantity > 1 ? "s" : ""
      } for "${payload["labelText"]}"`
    );
  }

  // const process = printLabel.spawn();

  // console.log(await process.status);

  return new Response("", { status: 404 });
};

const generatePdf = async (labelText: string) => {
  // Create a new PDFDocument
  const pdfDoc = await PDFDocument.create();

  // Add a page to the PDFDocument and draw some text
  const page = pdfDoc.addPage([162, 90]);
  page.drawText("item:", {
    x: 10,
    y: 70,
    color: grayscale(0.7),
    size: 12,
  });
  page.drawText(labelText, {
    x: 10,
    y: 54,
    size: 12,
  });
  page.drawText("made:", {
    x: 10,
    y: 26,
    color: grayscale(0.7),
    size: 12,
  });
  page.drawText(new Date().toISOString().split("T")[0], {
    x: 10,
    y: 10,
    size: 12,
  });

  // Save the PDFDocument and write it to a file
  const pdfBytes = await pdfDoc.save();
  const newFileName = `${Date.now()}.pdf`;
  await Deno.writeFile(newFileName, pdfBytes);

  // Done! 💥
  console.log(`PDF file written to ${newFileName}`);
  return newFileName;
};

const printLabel = async (fileName: string, copies: number) => {
  console.log("printing file...");
  const printJob = new Deno.Command("lp", {
    args: [
      "lp", // linux print command
      "-n", // "n"umber of copies
      copies.toString(),
      "-o",
      "Collate=True",
      "-d",
      "dymo",
      fileName,
    ],
  });
  return await printJob.output();
};
