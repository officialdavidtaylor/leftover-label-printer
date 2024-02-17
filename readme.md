# `leftover-label-printer`

> **Inspiration:**
> 
> I was tired of finding containers of food in the back of the fridge and having no idea of how old the food was; the precautionary principle would always compell me to throw the contents in the bin.
>
> Now I'm fully informed of the age of the food I inevitably throw away anyways. :)

## Target hardware:

- Raspberry Pi CM4
- Dymo LabelWriter 450 (USB thermal label printer)
  - **Note:** Linux CUPS and the thermal label printer driver both need to be installed on the Pi; The printer name must be "dymo" for this app to function as expected.

## Usage instructions:

To Compile for Raspberry Pi, you will need to pull the repo and execute the following command from a computer with Go build tools installed:
> `env GOOS=linux GOARCH=arm GOARM=7 go build -C src -o ../bin/app main.go`
>
> **Note:** if compiling for the Pi Zero or one of the older models, use `GOARM=6` to ensure compatiblity

Once the server is up and running, you can use this [Siri Shortcut](https://www.icloud.com/shortcuts/ada1cd06bab0419cabb734dcaa3383d1) to start printing!

My goal is to eventually serve the binary via GitHub releases... that's a Phase 2™️ goal at this point.

## Dev instructions:

- quickly compile and run the app > `go run -C src main.go`
- compile for host platform > `go build -C src -o ../bin/app main.go`
- run all tests > `go test -C src ./...`

---

*This is my first venture into the Internet of Food (Prep), and hopefully not the last.*