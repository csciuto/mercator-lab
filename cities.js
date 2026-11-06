// [name, lat, lon, tier]  tier 1 shows at world view, 2 from 2x zoom, 3 from 4x
var CITIES = [
 ["New York",40.71,-74.01,1],["Los Angeles",34.05,-118.24,1],["Chicago",41.88,-87.63,1],["Mexico City",19.43,-99.13,1],
 ["São Paulo",-23.55,-46.63,1],["Buenos Aires",-34.60,-58.38,1],["London",51.51,-0.13,1],["Paris",48.86,2.35,1],
 ["Moscow",55.76,37.62,1],["Cairo",30.04,31.24,1],["Lagos",6.52,3.38,1],["Johannesburg",-26.20,28.05,1],
 ["Istanbul",41.01,28.98,1],["Dubai",25.20,55.27,1],["Mumbai",19.08,72.88,1],["Delhi",28.61,77.21,1],
 ["Beijing",39.90,116.41,1],["Shanghai",31.23,121.47,1],["Tokyo",35.68,139.69,1],["Singapore",1.35,103.82,1],
 ["Sydney",-33.87,151.21,1],["Boston",42.36,-71.06,1],["Bogotá",4.71,-74.07,1],["Lima",-12.05,-77.04,1],
 ["Jakarta",-6.21,106.85,1],["Seoul",37.57,126.98,1],["Hong Kong",22.32,114.17,1],["Nairobi",-1.29,36.82,1],
 ["Tehran",35.69,51.39,1],["Reykjavík",64.15,-21.94,1],["Anchorage",61.22,-149.90,1],["Honolulu",21.31,-157.86,1],
 ["Auckland",-36.85,174.76,1],["Perth",-31.95,115.86,1],["Santiago",-33.45,-70.67,1],["Toronto",43.65,-79.38,1],
 ["Kinshasa",-4.44,15.27,1],
 ["San Francisco",37.77,-122.42,2],["Seattle",47.61,-122.33,2],["Miami",25.76,-80.19,2],["Houston",29.76,-95.37,2],
 ["Denver",39.74,-104.99,2],["Vancouver",49.28,-123.12,2],["Montreal",45.50,-73.57,2],["Washington",38.91,-77.04,2],
 ["Atlanta",33.75,-84.39,2],["Minneapolis",44.98,-93.27,2],["Havana",23.11,-82.37,2],["Rio de Janeiro",-22.91,-43.17,2],
 ["Caracas",10.48,-66.90,2],["Madrid",40.42,-3.70,2],["Rome",41.90,12.50,2],["Berlin",52.52,13.40,2],
 ["Stockholm",59.33,18.07,2],["Oslo",59.91,10.75,2],["Helsinki",60.17,24.94,2],["Amsterdam",52.37,4.90,2],
 ["Kyiv",50.45,30.52,2],["Kharkiv",49.99,36.23,2],["Athens",37.98,23.73,2],["Lisbon",38.72,-9.14,2],
 ["Casablanca",33.57,-7.59,2],["Dakar",14.72,-17.47,2],["Addis Ababa",9.03,38.74,2],["Riyadh",24.71,46.68,2],
 ["Karachi",24.86,67.01,2],["Dhaka",23.81,90.41,2],["Kolkata",22.57,88.36,2],["Bangkok",13.76,100.50,2],
 ["Manila",14.60,120.98,2],["Osaka",34.69,135.50,2],["Melbourne",-37.81,144.96,2],["Cape Town",-33.92,18.42,2],
 ["Ulaanbaatar",47.89,106.91,2],["Novosibirsk",55.01,82.93,2],["Vladivostok",43.12,131.89,2],["Nuuk",64.18,-51.72,2],
 ["Phoenix",33.45,-112.07,3],["Dallas",32.78,-96.80,3],["New Orleans",29.95,-90.07,3],["Philadelphia",39.95,-75.17,3],
 ["Halifax",44.65,-63.57,3],["Calgary",51.05,-114.07,3],["Winnipeg",49.90,-97.14,3],["Guadalajara",20.67,-103.35,3],
 ["Panama City",8.98,-79.52,3],["Quito",-0.18,-78.47,3],["La Paz",-16.50,-68.15,3],["Montevideo",-34.90,-56.16,3],
 ["Dublin",53.35,-6.26,3],["Edinburgh",55.95,-3.19,3],["Vienna",48.21,16.37,3],["Warsaw",52.23,21.01,3],
 ["Prague",50.08,14.44,3],["Budapest",47.50,19.04,3],["Barcelona",41.39,2.17,3],["Algiers",36.75,3.06,3],
 ["Tunis",36.81,10.18,3],["Accra",5.60,-0.19,3],["Luanda",-8.84,13.23,3],["Dar es Salaam",-6.79,39.21,3],
 ["Khartoum",15.50,32.56,3],["Baghdad",33.31,44.36,3],["Tashkent",41.30,69.24,3],["Almaty",43.24,76.95,3],
 ["Kabul",34.53,69.17,3],["Bengaluru",12.97,77.59,3],["Chennai",13.08,80.27,3],["Colombo",6.93,79.86,3],
 ["Hanoi",21.03,105.85,3],["Ho Chi Minh City",10.82,106.63,3],["Taipei",25.03,121.57,3],["Chengdu",30.57,104.07,3],
 ["Guangzhou",23.13,113.26,3],["Yakutsk",62.03,129.73,3],["Darwin",-12.46,130.84,3],["Brisbane",-27.47,153.03,3],
 ["Wellington",-41.29,174.78,3],["Suva",-18.14,178.44,3],["Murmansk",68.97,33.08,3],["Antananarivo",-18.88,47.51,3],
 ["Ushuaia",-54.80,-68.30,3],["Fairbanks",64.84,-147.72,3]
];

// name of a known place at exactly this point, if any ([name, lat, lon, ...] lists, or PLACES-style [name, where, lat, lon])
function cityAt(c, more) {
  var near = function (lat, lon) { return Math.abs(lat - c[1]) < 1e-3 && Math.abs(lon - c[0]) < 1e-3; };
  for (var i = 0; i < CITIES.length; i++) if (near(CITIES[i][1], CITIES[i][2])) return CITIES[i][0];
  if (more) for (var j = 0; j < more.length; j++) if (near(more[j][2], more[j][3])) return more[j][0];
  return undefined;
}
if (typeof module !== 'undefined') module.exports = { CITIES, cityAt };
