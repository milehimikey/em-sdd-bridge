model "Ping Fixture"

persona Integrator
context Pings
context Notifications

slice "Record Ping" {
  ui Ping Console @Integrator
  command Record Ping note "slices/record-ping.md" {
    postedAt: Instant,
    source: string
  }
  event Ping Recorded @Pings {
    postedAt: Instant,
    source: string
  }
}

slice "Recent Pings" {
  view Recent Pings from "Ping Recorded" note "slices/recent-pings.md"
  ui Recent Pings View @Integrator
}

slice "Pings To Notify" {
  view Pings To Notify from "Ping Recorded"
  processor Notify On Ping note "slices/pings-to-notify.md"
}

slice "Send Notification" {
  command Send Notification note "slices/send-notification.md" {
    pingId: UUID,
    channel: string
  }
  event Notification Sent @Notifications {
    pingId: UUID,
    channel: string
  }
}
