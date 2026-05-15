import React, { useState } from 'react';
import { startOfMonth, endOfMonth, eachDayOfInterval, format, isSameDay, startOfWeek, endOfWeek, isToday, addDays, getDay } from 'date-fns';
import { cn } from '../lib/utils';
import * as Icons from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export function CalendarWidget({ topics, logs = [] }: { topics: any[], logs?: any[] }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days = eachDayOfInterval({ start: startDate, end: endDate });

  const getDayData = (date: Date) => {
    const dayTopics = topics.filter(t => isSameDay(new Date(t.nextReviewUtc), date));
    return {
      reviewsCount: dayTopics.length,
      hasHighlyVolatile: dayTopics.some(t => t.volatilityScore > 7)
    };
  };

  const selectedData = getDayData(selectedDate);
  
  // Custom smart msg
  let smartMsg = "No reviews scheduled. Rest up!";
  if (selectedData.reviewsCount > 5) {
     smartMsg = `Heavy load: ${selectedData.reviewsCount} topics. Take regular breaks.`;
  } else if (selectedData.reviewsCount > 0) {
     smartMsg = `Manageable: ${selectedData.reviewsCount} topics.`;
  }
  
  if (selectedData.hasHighlyVolatile) {
     smartMsg += " Watch out for highly volatile topics!";
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
                     "relative h-8 sm:h-10 w-full rounded-xl flex items-center justify-center text-xs font-semibold sm:text-sm transition-all duration-300",
                     !isTgtMonth ? "text-gray-300 pointer-events-none" : "hover:bg-black/5",
                     isSelected ? "bg-black text-white hover:bg-black shadow-md ring-2 ring-black/10 ring-offset-1" : (isTD ? "bg-gray-100/80 text-black border border-gray-200/50" : "text-gray-700 bg-white/40 border border-white/40 block")
                   )}
                 >
                   {format(day, 'd')}
                   
                   {/* Activity indicator */}
                   {st.reviewsCount > 0 && isTgtMonth && (
                      <div className="absolute bottom-1 flex space-x-1 pointer-events-none items-center justify-center w-full">
                         <div className={cn("w-1.5 h-1.5 rounded-full shadow-sm", isSelected ? "bg-white" : "bg-blue-500")} />
                         {st.reviewsCount > 3 && <div className={cn("w-1.5 h-1.5 rounded-full shadow-sm", isSelected ? "bg-white" : "bg-orange-500")} />}
                         {st.reviewsCount > 6 && <div className={cn("w-1.5 h-1.5 rounded-full shadow-sm", isSelected ? "bg-white" : "bg-red-500")} />}
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
            
            {selectedData.reviewsCount > 0 ? (
               <div className="space-y-4 max-h-[140px] overflow-y-auto pr-1 custom-scrollbar">
                  {topics.filter(t => isSameDay(new Date(t.nextReviewUtc), selectedDate)).map((t, idx) => (
                     <div key={idx} className="flex items-start space-x-3 text-sm">
                        <div className="w-1.5 h-1.5 rounded-full bg-black mt-1.5 shrink-0" />
                        <div>
                           <p className="font-semibold text-gray-900 leading-tight">{t.title}</p>
                           <p className="text-xs text-gray-500 mt-0.5">{format(new Date(t.nextReviewUtc), 'h:mm a')}</p>
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
