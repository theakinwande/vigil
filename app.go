package main

import (
	"context"
	"database/sql"
	"log"
	"time"

	"github.com/theakinwande/vigil/db"
	"github.com/theakinwande/vigil/reminder"
	"github.com/theakinwande/vigil/tracker"
)

const (
	idleThreshold        = 5 * time.Minute
	defaultBreakInterval = 45 // minutes
)

// App is the Wails-bound application struct.
type App struct {
	ctx      context.Context
	db       *sql.DB
	tracker  *tracker.Tracker
	reminder *reminder.Reminder
}

// NewApp creates a new App application struct.
func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	database, err := db.Open()
	if err != nil {
		log.Printf("vigil: db open: %v", err)
		return
	}
	a.db = database

	a.tracker = tracker.New(
		func(s tracker.Session) error {
			if err := db.RecordSession(a.db, db.Session{
				AppName:  s.AppName,
				ExePath:  s.ExePath,
				Category: s.Category,
				Duration: s.Duration,
			}); err != nil {
				return err
			}
			startedAt := s.StartedAt
			if startedAt.IsZero() {
				startedAt = time.Now()
			}
			date := startedAt.Format("2006-01-02")
			return db.RecordTimeline(a.db, s.AppName, s.Category, date, startedAt.Hour(), s.Duration)
		},
		func(exe string) string { return db.GetCategory(a.db, exe) },
	)
	a.tracker.Start(idleThreshold)

	a.reminder = reminder.New(defaultBreakInterval)
	a.reminder.Start()
}

func (a *App) shutdown(ctx context.Context) {
	if a.tracker != nil {
		a.tracker.Flush()
		a.tracker.Stop()
	}
	if a.reminder != nil {
		a.reminder.Stop()
	}
	if a.db != nil {
		_ = a.db.Close()
	}
}

// GetTodaySummary returns today's totals per app.
func (a *App) GetTodaySummary() []db.DailySummary {
	if a.db == nil {
		return nil
	}
	rows, err := db.GetTodaySummary(a.db)
	if err != nil {
		log.Printf("vigil: today summary: %v", err)
		return nil
	}
	return rows
}

// GetWeeklySummary returns totals per (date, app) for the week containing weekStart.
func (a *App) GetWeeklySummary(weekStart string) []db.DailySummary {
	if a.db == nil {
		return nil
	}
	rows, err := db.GetWeeklySummary(a.db, weekStart)
	if err != nil {
		log.Printf("vigil: weekly summary: %v", err)
		return nil
	}
	return rows
}

// GetWeeklyStats returns iPhone-Screen-Time-style summary for the week containing weekStart.
func (a *App) GetWeeklyStats(weekStart string) db.WeeklyStats {
	if a.db == nil {
		return db.WeeklyStats{}
	}
	stats, err := db.GetWeeklyStats(a.db, weekStart)
	if err != nil {
		log.Printf("vigil: weekly stats: %v", err)
		return db.WeeklyStats{}
	}
	return stats
}

// GetAvailableWeeks returns distinct Monday dates (YYYY-MM-DD, oldest first) for
// every week that has at least one recorded session.
func (a *App) GetAvailableWeeks() []string {
	if a.db == nil {
		return nil
	}
	weeks, err := db.GetAvailableWeeks(a.db)
	if err != nil {
		log.Printf("vigil: available weeks: %v", err)
		return nil
	}
	return weeks
}

// GetCurrentWeekStart returns the Monday of the current week as YYYY-MM-DD.
func (a *App) GetCurrentWeekStart() string {
	t := time.Now()
	weekday := int(t.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	monday := t.AddDate(0, 0, -(weekday - 1))
	return monday.Format("2006-01-02")
}

// GetHourlyTimeline returns today's 24 hourly slots with per-app breakdown.
func (a *App) GetHourlyTimeline() []db.HourlySlot {
	if a.db == nil {
		return nil
	}
	today := time.Now().Format("2006-01-02")
	result, err := db.GetHourlyTimeline(a.db, today)
	if err != nil {
		log.Printf("vigil: hourly timeline: %v", err)
		return nil
	}
	return result
}

// SetCategory sets a user-override category for an app.
func (a *App) SetCategory(exeName, category string) {
	if a.db == nil {
		return
	}
	if err := db.SetCategory(a.db, exeName, category); err != nil {
		log.Printf("vigil: set category: %v", err)
	}
}

// SetBreakInterval updates the break reminder interval in minutes.
func (a *App) SetBreakInterval(mins int) {
	if a.reminder != nil && mins > 0 {
		a.reminder.SetInterval(mins)
	}
}

// TogglePause flips the tracker's paused state and returns the new value.
func (a *App) TogglePause() bool {
	if a.tracker == nil {
		return false
	}
	if a.tracker.IsPaused() {
		a.tracker.Resume()
	} else {
		a.tracker.Pause()
	}
	return a.tracker.IsPaused()
}
