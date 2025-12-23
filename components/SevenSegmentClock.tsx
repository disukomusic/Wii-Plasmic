import * as React from "react";

export interface SevenSegmentClockProps {
    className?: string;

    /** Font for the main clock (hours + minutes) */
    clockFontFamily?: string;

    /** Font for the AM / PM text */
    ampmFontFamily?: string;
}

export const SevenSegmentClock: React.FC<SevenSegmentClockProps> = ({
        className,
        clockFontFamily = "monospace",
        ampmFontFamily = "sans-serif",
    }) => {
    const [time, setTime] = React.useState({
        hrs: "--",
        mins: "--",
        ampm: "",
    });

    const [showColon, setShowColon] = React.useState(true);

    React.useEffect(() => {
        function tick() {
            const now = new Date();
            let h = now.getHours();
            let m = now.getMinutes();
            let ampm = h >= 12 ? "PM" : "AM";

            h = h % 12 || 12;

            const hStr = h < 10 ? " " + h : String(h);
            const mStr = m < 10 ? "0" + m : String(m);

            setTime({ hrs: hStr, mins: mStr, ampm });

            // Toggle colon every second
            setShowColon((prev) => !prev);
        }

        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, []);

    return (
        <div
            className={className}
            style={{
                display: "flex",
                alignItems: "baseline",
                fontFamily: clockFontFamily,
            }}
        >
            <span>{time.hrs}</span>

            {/* Blinking colon */}
            <span
                style={{
                    margin: "0 6px",
                    opacity: showColon ? 1 : 0,
                    transition: "opacity 0.1s linear",
                }}
            >
        :
      </span>

            <span>{time.mins}</span>

            {/* AM / PM */}
            <span
                style={{
                    marginLeft: 12,
                    fontSize: "18px",
                    fontFamily: ampmFontFamily,
                }}
            >
        {time.ampm}
      </span>
        </div>
    );
};
