package main

import (
	"context"
	"embed"

	"fyne.io/systray"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/windows/icon.ico
var trayIcon []byte

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:             "Vigil",
		Width:             900,
		Height:            600,
		HideWindowOnClose: true,
		StartHidden:       true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 18, G: 20, B: 27, A: 1},
		OnStartup: func(ctx context.Context) {
			app.startup(ctx)
			go runTray(ctx)
		},
		OnShutdown: app.shutdown,
		Windows: &windows.Options{
			WebviewIsTransparent:              false,
			WindowIsTranslucent:               false,
			DisableWindowIcon:                 false,
			DisableFramelessWindowDecorations: false,
		},
		Bind: []interface{}{app},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}

func runTray(ctx context.Context) {
	systray.Run(func() {
		systray.SetIcon(trayIcon)
		systray.SetTitle("Vigil")
		systray.SetTooltip("Vigil — screen time tracker")

		mShow := systray.AddMenuItem("Show Vigil", "Open the Vigil dashboard")
		systray.AddSeparator()
		mQuit := systray.AddMenuItem("Quit", "Exit Vigil")

		go func() {
			for {
				select {
				case <-mShow.ClickedCh:
					wailsruntime.WindowShow(ctx)
				case <-mQuit.ClickedCh:
					wailsruntime.Quit(ctx)
					return
				case <-ctx.Done():
					return
				}
			}
		}()
	}, func() {})
}
