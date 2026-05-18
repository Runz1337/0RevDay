import React, { useState } from 'react';
import { startOfMonth, endOfMonth, eachDayOfInterval, format, isSameDay, startOfWeek, endOfWeek, isToday, addDays, getDay } from 'date-fns';
import { cn } from '../lib/utils';
import * as Icons from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export function CalendarWidget({ topics, logs = [], onReviewComplete }: { topics: any[], logs?: any[], onReviewComplete?: (id: string, confidence: number) => void }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days = eachDayOfInterval({ start: startDate, end: endDate });

  const getDayData = (date: Date) => {
    const startOfD = new Date(date).setHours(0, 0, 0, 0);
    const endOfD = new Date(date).setHours(23, 59, 59, 999);
    const now = Date.now();
    const isToday = now >= startOfD && now <= endOfD;
    const isPast = now > endOfD;
    const isDayRunningOut = isToday && now >= endOfD - (2 * 60 * 60 * 1000);

    const dots = {
       pink: false,
       green: false,
       blue: false,
       red: false,
       orange: false
    };

    const pending = [];
    const skipped = [];
    const completed = [];
    const created = [];
    let hasPendingFade = false;
    let hasRunningOutFade = false;

    topics.forEach(t => {
      // Achievement: Created new topic
      if (t.createdAt && t.createdAt >= startOfD && t.createdAt <= endOfD) {
         created.push(t);
         dots.pink = true;
      }

      if (!t.isCompleted && t.nextReviewUtc >= startOfD && t.nextReviewUtc <= endOfD) {
         if (isPast) {
            skipped.push(t);
            if (t.isOptional) dots.orange = true;
            else dots.red = true;
         } else {
            pending.push(t);
            if (isDayRunningOut) {
               dots.red = true; // Red dot when day is running out
               hasRunningOutFade = true; // Red fade temporary
            } else {
               dots.blue = true; // Normal pending dot
               hasPendingFade = true; // Blue fade temporary
            }
         }
      }

      if (t.reviewHistory) {
         t.reviewHistory.forEach((h: any) => {
            if (h.date >= startOfD && h.date <= endOfD) {
               completed.push({ ...t, historyLog: h });
               if (h.status === 'on-time') dots.green = true;
               else if (h.status === 'early') dots.pink = true;
               else if (h.status === 'late') dots.red = true;
            }
         });
      }
    });

    return {
      pending,
      skipped,
      completed,
      created,
      totalCount: pending.length + skipped.length + completed.length + created.length,
      dots,
      hasPendingFade,
      hasRunningOutFade,
      hasHighlyVolatile: pending.some(t => t.volatilityScore > 7) || skipped.some((t: any) => t.volatilityScore > 7)
    };
  };

  const selectedData = getDayData(selectedDate);
  
  // Custom smart msg
  let smartMsg = "No reviews scheduled. Rest up!";
  if (selectedData.skipped.length > 0 && selectedData.pending.length > 0) {
      smartMsg = `You have ${selectedData.skipped.length} overdue tasks and ${selectedData.pending.length} pending tasks.`;
  } else if (selectedData.skipped.length > 0) {
      smartMsg = `You have ${selectedData.skipped.length} overdue tasks. Catch up!`;
  } else if (selectedData.pending.length > 5) {
     smartMsg = `Heavy load: ${selectedData.pending.length} topics pending. Take regular breaks.`;
  } else if (selectedData.pending.length > 0) {
     smartMsg = `Manageable: ${selectedData.pending.length} pending topics.`;
  } else if (selectedData.completed.length > 0) {
     smartMsg = `Great job! You completed ${selectedData.completed.length} topics today.`;
  } else if (selectedData.created.length > 0) {
     smartMsg = `Great start! You logged ${selectedData.created.length} new achievements today.`;
  }
  
  if (selectedData.hasHighlyVolatile) {
     smartMsg += " Watch out for highly volatile topics!";
  }

  if (selectedData.created.length > 0 && (selectedData.skipped.length > 0 || selectedData.pending.length > 0 || selectedData.completed.length > 0)) {
     smartMsg += ` ✨ Added ${selectedData.created.length} new logs!`;
  }

  return (
    <div className="glass-panel rounded-[2rem] p-4 sm:p-5 shadow-[0_8px_32px_rgba(0,0,0,0.06)] mb-8 flex flex-col md:flex-row gap-6 items-start relative z-20 border border-white/60">
      
      {/* Calendar Side */}
      <div className="w-full md:w-auto min-w-[280px]">
         <div className="flex items-center justify-between mb-4 px-2">
            <h3 className="font-bold text-gray-900 tracking-tight">{format(currentDate, 'MMMM yyyy')}</h3>
            <div className="flex space-x-1">
               <button onClick={() => setCurrentDate(addDays(monthStart, -1))} className="p-1 hover:bg-black/5 rounded-full text-gray-500 hover:text-gray-900 transition-colors">
                  <Icons.ChevronLeft size={16} />
               </button>
               <button onClick={() => setCurrentDate(addDays(monthEnd, 1))} className="p-1 hover:bg-black/5 rounded-full text-gray-500 hover:text-gray-900 transition-colors">
                  <Icons.ChevronRight size={16} />
               </button>
            </div>
         </div>
         
         <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center mb-2">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
               <div key={d} className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{d}</div>
            ))}
         </div>
         
         <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {days.map(day => {
               const st = getDayData(day);
               const isSelected = isSameDay(day, selectedDate);
               const isTgtMonth = day.getMonth() === currentDate.getMonth();
               const isTD = isToday(day);
               
               return (
                 <button
                   key={day.toString()}
                   onClick={() => setSelectedDate(day)}
                   className={cn(
                     "relative h-8 sm:h-10 w-full rounded-xl flex items-center justify-center text-xs font-semibold sm:text-sm transition-all duration-300 overflow-hidden",
                     !isTgtMonth ? "text-gray-300 pointer-events-none" : "hover:bg-black/5",
                     isSelected ? "bg-black text-white hover:bg-black shadow-md ring-2 ring-black/10 ring-offset-1" : (isTD ? "bg-blue-50 text-blue-700 border border-blue-200 shadow-sm" : "text-gray-700 bg-white/40 border border-white/40 block")
                   )}
                 >
                   {/* Background Fade effects for pending and running out */}
                   {!isSelected && isTgtMonth && st.hasRunningOutFade && (
                      <div className="absolute inset-0 bg-gradient-to-br from-red-400 via-transparent to-transparent opacity-100 pointer-events-none" />
                   )}
                   {!isSelected && isTgtMonth && st.hasPendingFade && !st.hasRunningOutFade && (
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-400 via-transparent to-transparent opacity-100 pointer-events-none" />
                   )}

                   <span className="relative z-10">{format(day, 'd')}</span>
                   
                   {/* Activity indicator */}
                   {isTgtMonth && (Object.values(st.dots).some(v => v)) && (
                      <div className="absolute bottom-1 flex space-x-1 pointer-events-none items-center justify-center w-full z-10">
                         {st.dots.pink && <div className={cn("w-1 h-1 rounded-full shadow-sm", isSelected ? "bg-white" : "bg-pink-500")} />}
                         {st.dots.green && <div className={cn("w-1 h-1 rounded-full shadow-sm", isSelected ? "bg-white" : "bg-green-500")} />}
                         {st.dots.blue && <div className={cn("w-1 h-1 rounded-full shadow-sm", isSelected ? "bg-white" : "bg-blue-500")} />}
                         {st.dots.red && <div className={cn("w-1 h-1 rounded-full shadow-sm", isSelected ? "bg-white" : "bg-red-500")} />}
                         {st.dots.orange && <div className={cn("w-1 h-1 rounded-full shadow-sm", isSelected ? "bg-white" : "bg-orange-500")} />}
                      </div>
                   )}
                 </button>
               )
            })}
         </div>
      </div>
      
      {/* Detail Side (Smart Sync) */}
      <div className="flex-1 w-full bg-gradient-to-br from-white/60 to-white/20 rounded-[1.5rem] p-4 sm:p-5 border border-white/50 shadow-sm relative overflow-hidden">
         <div className="absolute -top-10 -right-10 w-32 h-32 bg-blue-100/50 rounded-full blur-3xl pointer-events-none" />
         <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-pink-100/50 rounded-full blur-3xl pointer-events-none" />
         
         <div className="relative z-10">
            <div className="flex items-center space-x-2 text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">
               <Icons.Sparkles size={12} className="text-blue-500" />
               <span>AI Revision Sync</span>
            </div>
            
            <h4 className="text-lg font-semibold tracking-tight text-gray-900 mb-3">
               {format(selectedDate, 'EEEE, MMM do')}
            </h4>
            
            <div className="bg-white/40 backdrop-blur-md rounded-xl p-3 border border-white/60 mb-4 text-sm font-medium text-gray-800 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)]">
               {smartMsg}
            </div>
            
            {selectedData.totalCount > 0 ? (
               <div className="space-y-4 max-h-[140px] overflow-y-auto pr-1 custom-scrollbar">
                  {selectedData.skipped.map((t: any, idx: number) => (
                     <div key={`s-${idx}`} className="flex items-start justify-between text-sm group">
                        <div className="flex items-start space-x-3">
                           <div className={cn("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0", t.isOptional ? "bg-orange-500" : "bg-red-500")} />
                           <div>
                              <p className="font-semibold text-gray-900 leading-tight">{t.title}</p>
                              <p className={cn("text-xs font-medium mt-0.5", t.isOptional ? "text-orange-500" : "text-red-500")}>
                                 {t.isOptional ? "Optional Overdue" : "Overdue"} • {format(new Date(t.nextReviewUtc), 'h:mm a')}
                              </p>
                           </div>
                        </div>
                        {onReviewComplete && (
                           <button onClick={(e) => { e.stopPropagation(); onReviewComplete(t.id, 1.0); }} className="opacity-0 group-hover:opacity-100 bg-pink-50 text-pink-600 border border-pink-200 hover:bg-pink-100 px-2 py-1 rounded text-xs font-semibold whitespace-nowrap transition-all">
                              Complete
                           </button>
                        )}
                     </div>
                  ))}
                  {selectedData.pending.map((t: any, idx: number) => (
                     <div key={`p-${idx}`} className="flex items-start justify-between text-sm group">
                        <div className="flex items-start space-x-3">
                           <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                           <div>
                              <p className="font-semibold text-gray-900 leading-tight">{t.title}</p>
                              <p className="text-xs text-blue-500 font-medium mt-0.5">Pending • {format(new Date(t.nextReviewUtc), 'h:mm a')}</p>
                           </div>
                        </div>
                        {onReviewComplete && (
                           <button onClick={(e) => { e.stopPropagation(); onReviewComplete(t.id, 1.0); }} className="opacity-0 group-hover:opacity-100 bg-pink-50 text-pink-600 border border-pink-200 hover:bg-pink-100 px-2 py-1 rounded text-xs font-semibold whitespace-nowrap transition-all">
                              Complete
                           </button>
                        )}
                     </div>
                  ))}
                  {selectedData.completed.map((t: any, idx: number) => {
                     const h = t.historyLog;
                     const colorBg = h?.status === 'on-time' ? 'bg-green-500' : h?.status === 'early' ? 'bg-pink-500' : 'bg-red-500';
                     const colorText = h?.status === 'on-time' ? 'text-green-600' : h?.status === 'early' ? 'text-pink-600' : 'text-red-600';
                     const label = h?.status === 'on-time' ? 'Completed On Time' : h?.status === 'early' ? 'Completed Early' : 'Completed Late';

                     return (
                        <div key={`c-${idx}`} className="flex items-start space-x-3 text-sm opacity-60">
                           <div className={cn("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0", colorBg)} />
                           <div>
                              <p className="font-semibold text-gray-900 leading-tight line-through">{t.title}</p>
                              <p className={cn("text-xs font-medium mt-0.5", colorText)}>{label}</p>
                           </div>
                        </div>
                     );
                  })}
                  {selectedData.created.map((t: any, idx: number) => (
                     <div key={`cr-${idx}`} className="flex items-start space-x-3 text-sm">
                        <div className="w-1.5 h-1.5 rounded-full bg-pink-500 mt-1.5 shrink-0" />
                        <div>
                           <p className="font-semibold text-gray-900 leading-tight">{t.title}</p>
                           <p className="text-xs text-pink-600 font-medium mt-0.5 flex items-center space-x-1">
                             <Icons.Star size={10} />
                             <span>Achievement: New Log Added</span>
                           </p>
                        </div>
                     </div>
                  ))}
               </div>
            ) : (
               <div className="flex flex-col items-center justify-center py-6 text-center">
                  <div className="w-10 h-10 rounded-full bg-white/60 shadow-sm flex items-center justify-center mb-2">
                     <Icons.Coffee size={18} className="text-gray-400" />
                  </div>
                  <p className="text-xs text-gray-500 font-medium tracking-wide">Take a well-deserved break.</p>
               </div>
            )}
         </div>
      </div>
      
    </div>
  );
}
