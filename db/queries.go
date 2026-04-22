package db

import (
	"database/sql"
	"strings"
	"time"

	"github.com/theakinwande/vigil/tracker"
)

const dateFormat = "2006-01-02"

// Session mirrors tracker.Session but is the DB-facing shape exposed to the frontend.
type Session struct {
	AppName  string `json:"appName"`
	ExePath  string `json:"exePath"`
	Category string `json:"category"`
	Duration int64  `json:"duration"`
}

// DailySummary is one (date, app) row with its total seconds.
type DailySummary struct {
	Date     string `json:"date"`
	AppName  string `json:"appName"`
	Category string `json:"category"`
	Total    int64  `json:"total"`
}

// RecordSession inserts or upserts a session for today (per app_name+date).
func RecordSession(db *sql.DB, s Session) error {
	date := time.Now().Format(dateFormat)
	_, err := db.Exec(`
		INSERT INTO sessions(app_name, exe_path, category, date, duration)
		VALUES(?, ?, ?, ?, ?)
		ON CONFLICT(app_name, date) DO UPDATE SET
			duration = duration + excluded.duration,
			exe_path = excluded.exe_path,
			category = excluded.category
	`, s.AppName, s.ExePath, s.Category, date, s.Duration)
	return err
}

// GetTodaySummary returns today's totals per app, ordered by total DESC.
func GetTodaySummary(db *sql.DB) ([]DailySummary, error) {
	date := time.Now().Format(dateFormat)
	rows, err := db.Query(`
		SELECT date, app_name, category, SUM(duration) AS total
		FROM sessions
		WHERE date = ?
		GROUP BY app_name
		ORDER BY total DESC
	`, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DailySummary
	for rows.Next() {
		var s DailySummary
		if err := rows.Scan(&s.Date, &s.AppName, &s.Category, &s.Total); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// WeekBounds returns the Monday and Sunday (YYYY-MM-DD) of the week containing weekStart.
// If weekStart is already a Monday it's returned as-is.
func WeekBounds(weekStart string) (start, end string) {
	t, err := time.Parse(dateFormat, weekStart)
	if err != nil {
		return weekStart, weekStart
	}
	weekday := int(t.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	monday := t.AddDate(0, 0, -(weekday - 1))
	sunday := monday.AddDate(0, 0, 6)
	return monday.Format(dateFormat), sunday.Format(dateFormat)
}

// GetWeeklySummary returns one (date, app) total for every session row within the given week.
func GetWeeklySummary(db *sql.DB, weekStart string) ([]DailySummary, error) {
	start, end := WeekBounds(weekStart)
	rows, err := db.Query(`
		SELECT date, app_name, category, SUM(duration) AS total
		FROM sessions
		WHERE date >= ? AND date <= ?
		GROUP BY date, app_name
		ORDER BY date DESC, total DESC
	`, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DailySummary
	for rows.Next() {
		var s DailySummary
		if err := rows.Scan(&s.Date, &s.AppName, &s.Category, &s.Total); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// GetAvailableWeeks returns distinct Mondays (YYYY-MM-DD, oldest first) for every
// week that has at least one recorded session.
func GetAvailableWeeks(db *sql.DB) ([]string, error) {
	rows, err := db.Query(`
		SELECT DISTINCT date(date, 'weekday 0', '-6 days') AS week_start
		FROM sessions
		ORDER BY week_start ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var weeks []string
	for rows.Next() {
		var w string
		if err := rows.Scan(&w); err != nil {
			return nil, err
		}
		weeks = append(weeks, w)
	}
	return weeks, rows.Err()
}

// DayTotal is one day in a 7-day rollup, with its label and total seconds.
type DayTotal struct {
	Date    string `json:"date"`
	Label   string `json:"label"`
	Total   int64  `json:"total"`
	IsToday bool   `json:"is_today"`
}

// WeeklyStats is an iPhone-Screen-Time-style rollup for the last 7 days.
type WeeklyStats struct {
	DailyAverage int64      `json:"daily_average"`
	TotalWeek    int64      `json:"total_week"`
	BusiestDay   string     `json:"busiest_day"`
	BusiestApp   string     `json:"busiest_app"`
	DailyTotals  []DayTotal `json:"daily_totals"`
}

// GetWeeklyStats returns daily-average / busiest-day / busiest-app / per-day totals
// for the week containing weekStart (Mon..Sun).
func GetWeeklyStats(db *sql.DB, weekStart string) (WeeklyStats, error) {
	start, end := WeekBounds(weekStart)

	rows, err := db.Query(`
		SELECT date, SUM(duration) AS total
		FROM sessions
		WHERE date >= ? AND date <= ?
		GROUP BY date
		ORDER BY date ASC
	`, start, end)
	if err != nil {
		return WeeklyStats{}, err
	}
	defer rows.Close()

	totalsMap := make(map[string]int64)
	var weekTotal int64
	for rows.Next() {
		var date string
		var total int64
		if err := rows.Scan(&date, &total); err != nil {
			return WeeklyStats{}, err
		}
		totalsMap[date] = total
		weekTotal += total
	}
	if err := rows.Err(); err != nil {
		return WeeklyStats{}, err
	}

	monday, err := time.Parse(dateFormat, start)
	if err != nil {
		return WeeklyStats{}, err
	}
	todayStr := time.Now().Format(dateFormat)

	dailyTotals := make([]DayTotal, 7)
	var busiestDay string
	var busiestDayTotal int64
	for i := 0; i < 7; i++ {
		d := monday.AddDate(0, 0, i)
		dateStr := d.Format(dateFormat)
		total := totalsMap[dateStr]
		dailyTotals[i] = DayTotal{
			Date:    dateStr,
			Label:   d.Format("Mon"),
			Total:   total,
			IsToday: dateStr == todayStr,
		}
		if total > busiestDayTotal {
			busiestDayTotal = total
			busiestDay = d.Format("Monday")
		}
	}

	activeDays := 0
	for _, d := range dailyTotals {
		if d.Total > 0 {
			activeDays++
		}
	}
	var avg int64
	if activeDays > 0 {
		avg = weekTotal / int64(activeDays)
	}

	var busiestApp string
	_ = db.QueryRow(`
		SELECT app_name FROM sessions
		WHERE date >= ? AND date <= ?
		GROUP BY app_name
		ORDER BY SUM(duration) DESC
		LIMIT 1
	`, start, end).Scan(&busiestApp)

	return WeeklyStats{
		DailyAverage: avg,
		TotalWeek:    weekTotal,
		BusiestDay:   busiestDay,
		BusiestApp:   busiestApp,
		DailyTotals:  dailyTotals,
	}, nil
}

// HourlyApp is one app's contribution to a single hour slot.
type HourlyApp struct {
	AppName  string `json:"app_name"`
	Category string `json:"category"`
	Duration int64  `json:"duration"`
}

// HourlySlot aggregates all apps active in a single hour of a day.
type HourlySlot struct {
	Hour  int         `json:"hour"`
	Total int64       `json:"total"`
	Apps  []HourlyApp `json:"apps"`
}

// RecordTimeline upserts a (app, hour, date) bucket, adding to its duration.
func RecordTimeline(db *sql.DB, appName, category, date string, hour int, duration int64) error {
	_, err := db.Exec(`
		INSERT INTO timeline (app_name, category, date, hour, duration)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(app_name, hour, date)
		DO UPDATE SET duration = duration + excluded.duration
	`, appName, category, date, hour, duration)
	return err
}

// GetHourlyTimeline returns all 24 hour slots for the given date; empty slots are zeroed.
func GetHourlyTimeline(db *sql.DB, date string) ([]HourlySlot, error) {
	rows, err := db.Query(`
		SELECT hour, app_name, category, duration
		FROM timeline
		WHERE date = ?
		ORDER BY hour ASC, duration DESC
	`, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	slotMap := make(map[int]*HourlySlot)
	for rows.Next() {
		var hour int
		var app HourlyApp
		if err := rows.Scan(&hour, &app.AppName, &app.Category, &app.Duration); err != nil {
			return nil, err
		}
		if _, ok := slotMap[hour]; !ok {
			slotMap[hour] = &HourlySlot{Hour: hour}
		}
		slotMap[hour].Apps = append(slotMap[hour].Apps, app)
		slotMap[hour].Total += app.Duration
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make([]HourlySlot, 24)
	for i := range result {
		result[i].Hour = i
		if slot, ok := slotMap[i]; ok {
			result[i].Total = slot.Total
			result[i].Apps = slot.Apps
		}
	}
	return result, nil
}

// SetCategory upserts a per-app category override.
func SetCategory(db *sql.DB, exeName, category string) error {
	key := strings.ToLower(exeName)
	_, err := db.Exec(`
		INSERT INTO categories(exe_name, category) VALUES(?, ?)
		ON CONFLICT(exe_name) DO UPDATE SET category = excluded.category
	`, key, category)
	return err
}

// GetCategory returns the override, falling back to tracker.Categorize.
func GetCategory(db *sql.DB, exeName string) string {
	key := strings.ToLower(exeName)
	var cat string
	err := db.QueryRow(`SELECT category FROM categories WHERE exe_name = ?`, key).Scan(&cat)
	if err == nil && cat != "" {
		return cat
	}
	return tracker.Categorize(exeName)
}
