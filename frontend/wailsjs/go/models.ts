export namespace db {
	
	export class DailySummary {
	    date: string;
	    appName: string;
	    category: string;
	    total: number;
	
	    static createFrom(source: any = {}) {
	        return new DailySummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.appName = source["appName"];
	        this.category = source["category"];
	        this.total = source["total"];
	    }
	}
	export class DayTotal {
	    date: string;
	    label: string;
	    total: number;
	    is_today: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DayTotal(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.label = source["label"];
	        this.total = source["total"];
	        this.is_today = source["is_today"];
	    }
	}
	export class HourlyApp {
	    app_name: string;
	    category: string;
	    duration: number;
	
	    static createFrom(source: any = {}) {
	        return new HourlyApp(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.app_name = source["app_name"];
	        this.category = source["category"];
	        this.duration = source["duration"];
	    }
	}
	export class HourlySlot {
	    hour: number;
	    total: number;
	    apps: HourlyApp[];
	
	    static createFrom(source: any = {}) {
	        return new HourlySlot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hour = source["hour"];
	        this.total = source["total"];
	        this.apps = this.convertValues(source["apps"], HourlyApp);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WeeklyStats {
	    daily_average: number;
	    total_week: number;
	    busiest_day: string;
	    busiest_app: string;
	    daily_totals: DayTotal[];
	
	    static createFrom(source: any = {}) {
	        return new WeeklyStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.daily_average = source["daily_average"];
	        this.total_week = source["total_week"];
	        this.busiest_day = source["busiest_day"];
	        this.busiest_app = source["busiest_app"];
	        this.daily_totals = this.convertValues(source["daily_totals"], DayTotal);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

